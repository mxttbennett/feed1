const { MessageEmbed } = require('discord.js');
const { fetchuser } = require('./fetchuser');
const Library = require('../lib/index.js');
const { Op } = require('sequelize');
const canvas = require('canvas');
const path = require('path');

// Register font
canvas.registerFont(path.join(__dirname, '..', '..', 'NotoSansCJKjp-Regular.otf'), {
  family: 'noto-sans'
});

// Utility functions
const sortingFunc = (a, b) => parseInt(b.plays) - parseInt(a.plays);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function removeDuplicates(array) {
  return array.filter((a, b) => array.indexOf(a) === b);
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Time period configurations
const PERIODS = {
  weekly: {
    period: '7day',
    seconds: 604800,
    title: 'Weekly',
    url_preset: 'LAST_7_DAYS'
  },
  monthly: {
    period: '1month',
    seconds: 2592000,
    title: 'Monthly',
    url_preset: 'LAST_30_DAYS'
  },
  threeMonth: {
    period: '3month',
    seconds: 7776000,
    title: '3-Month',
    url_preset: 'LAST_90_DAYS'
  },
  sixMonth: {
    period: '6month',
    seconds: 15552000,
    title: '6-Month',
    url_preset: 'LAST_180_DAYS'
  },
  yearly: {
    period: '12month',
    seconds: 31556952,
    title: 'Yearly',
    url_preset: 'LAST_365_DAYS'
  },
  overall: {
    period: 'overall',
    seconds: null,
    title: 'Overall',
    url_preset: 'ALL'
  }
};

async function generateChartImage(client, message, data, options) {
  const { x, y, total, avg, date, date2, ACrowns, lib, fetchUser, user } = options;
  const { album } = data.topalbums;

  // Create initial canvas
  const canv = canvas.createCanvas(x * 100, y * 100);
  const ctx = canv.getContext('2d');

  // Load album images
  const proms = [];
  let num_missing = 0;
  const loadImage = async (url) => {
    try {
      return await canvas.loadImage(url);
    } catch (e) {
      num_missing += 1;
      return await canvas.loadImage(path.join(__dirname, '..', '..', 'images', 'no_album.png'));
    }
  };

  album.forEach(a => {
    if (a.image[3]['#text'].length > 0) {
      proms.push(loadImage(a.image[3]['#text']));
    } else {
      num_missing += 1;
      proms.push(loadImage(path.join(__dirname, '..', '..', 'images', 'no_album.png')));
    }
  });
  const imgs = await Promise.all(proms);

  // Draw album images
  let iter = 0;
  for (let yAxis = 0; yAxis < y * 100; yAxis += 100) {
    if (imgs[iter] !== undefined) {
      for (let xAxis = 0; xAxis < x * 100; xAxis += 100) {
        if (imgs[iter] !== undefined) {
          ctx.drawImage(imgs[iter], xAxis, yAxis, 100, 100);
          iter++;
        } else break;
      }
    } else break;
  }

  // Process album data
  const names = [];
  const art = [];
  const alb = [];
  const totalscrobs = [];
  const crowns = [];
  const scrobs = [];
  const scrobnum = [];
  const scrobsum = [];

  // Get album names and artists
  for (let z = 0; z < 50; z++) {
    album.forEach(a => names.push(`${a.artist.name} - ${a.name}`));
    album.forEach(a => art.push(`${a.artist.name}`));
    album.forEach(a => alb.push(`${a.name}`));
  }

  const uniqueNames = removeDuplicates(names);

  // Process album stats and crowns
  let counter = 0;
  for (let i = 0; i < uniqueNames.length; i++) {
    if (i % Math.floor(uniqueNames.length / 3) === 0) {
      counter++;
      if (counter === 1) await message.react('1️⃣');
      if (counter === 2) await message.react('2️⃣');
      if (counter === 3) await message.react('3️⃣');
    }

    try {
      const temp = await lib.album.getInfo(art[i], alb[i], user);
      totalscrobs.push(temp.album.userplaycount);

      const hasCrown = await ACrowns.findOne({
        where: {
          guildID: message.guild.id,
          albumName: temp.album.name,
          artistName: temp.album.artist
        }
      });

      if (hasCrown != null) {
        crowns.push(hasCrown.userID === message.author.id ? 1 : 0);
      } else {
        crowns.push(0);
      }
    } catch {
      totalscrobs.push(0);
      crowns.push(0);
    }
  }

  // Calculate scrobble stats
  for (let z = 0; z < uniqueNames.length; z++) {
    album.forEach(a => scrobs.push(`[${a.playcount} scrobbles - `));
    album.forEach(a => scrobnum.push(parseFloat(parseFloat((parseFloat(a.playcount) / total) * 100).toFixed(2))));
    album.forEach(a => scrobsum.push(parseInt(a.playcount)));
  }

  let sum = 0;
  for (let z = 0; z < uniqueNames.length; z++) {
    sum += parseInt(scrobsum[z]);
  }

  const avg2 = parseFloat((sum / ((date - date2) / 86400)).toFixed(2));
  
  if (sum > total) sum = total;

  // Create final canvas with text
  let longestNum = -Infinity;
  uniqueNames.forEach(name => {
    if (longestNum < name.length) {
      longestNum = name.length;
    }
  });

  const longestName = 'X'.repeat(15 + parseInt(longestNum)) + ' [88888 scrobbles - 100.00%] [8888 total scrobbles]';
  
  if (uniqueNames.length > 3) {
    await message.react('❗');
  }

  let newalbs = 0;
  let crowncount = 0;
  const { width } = ctx.measureText(longestName);
  const xAxis = x * 100 + 120 + width;
  const yAxis = y * 100;
  const finalCanvas = canvas.createCanvas(xAxis, yAxis);
  const fctx = finalCanvas.getContext('2d');

  // Draw background and album grid
  fctx.fillStyle = 'black';
  fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  fctx.drawImage(canv, 0, 0);
  fctx.font = '12px noto-sans';

  // Draw album names and stats
  let i = 0;
  for (let byChart = 0; byChart < 100 * y; byChart += 100) {
    for (let inChart = 15; inChart <= 15 * x; inChart += 15) {
      const yPos = byChart + inChart;
      if (scrobs[i] && uniqueNames[i]) {
        if (parseInt(scrobsum[i]) === parseInt(totalscrobs[i])) {
          newalbs++;
          if (crowns[i] === 1) {
            crowncount++;
            drawNewCrownedAlbum(fctx, uniqueNames[i], scrobs[i], scrobnum[i], x, yPos);
          } else {
            drawNewAlbum(fctx, uniqueNames[i], scrobs[i], scrobnum[i], x, yPos);
          }
        } else {
          if (crowns[i] === 1) {
            crowncount++;
            drawCrownedAlbum(fctx, uniqueNames[i], scrobs[i], scrobnum[i], totalscrobs[i], x, yPos);
          } else {
            drawRegularAlbum(fctx, uniqueNames[i], scrobs[i], scrobnum[i], totalscrobs[i], x, yPos);
          }
        }
      }
      if (uniqueNames[i]) {
        drawBaseName(fctx, uniqueNames[i], x, yPos);
      }
      i++;
    }
  }

  // Generate stats text
  const totalstat = generateStatsText(message.author.id, sum, total, avg2, avg, newalbs, crowncount, num_missing);

  return { buffer: finalCanvas.toBuffer(), stats: totalstat };
}

function drawNewCrownedAlbum(ctx, name, scrobs, scrobnum, x, y) {
  ctx.fillStyle = '#ffff00';
  ctx.fillText(`${name} ${scrobs}${scrobnum}%] !! NEW !! ♛`, x * 100 + 15, y);
  ctx.fillStyle = '#32cd32';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%] !! NEW !!`, x * 100 + 15, y);
  }
  ctx.fillStyle = '#16E6FF';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%]`, x * 100 + 15, y);
  }
}

function drawNewAlbum(ctx, name, scrobs, scrobnum, x, y) {
  ctx.fillStyle = '#32cd32';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%] !! NEW !!`, x * 100 + 15, y);
  }
  ctx.fillStyle = '#16E6FF';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%]`, x * 100 + 15, y);
  }
}

function drawCrownedAlbum(ctx, name, scrobs, scrobnum, totalscrobbles, x, y) {
  ctx.fillStyle = '#ffff00';
  ctx.fillText(`${name} ${scrobs}${scrobnum}%] [${totalscrobbles} total scrobbles] ♛`, x * 100 + 15, y);
  ctx.fillStyle = '#ff00c0';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%] [${totalscrobbles} total scrobbles]`, x * 100 + 15, y);
  }
  ctx.fillStyle = '#16E6FF';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%]`, x * 100 + 15, y);
  }
}

function drawRegularAlbum(ctx, name, scrobs, scrobnum, totalscrobbles, x, y) {
  ctx.fillStyle = '#ff00c0';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%] [${totalscrobbles} total scrobbles]`, x * 100 + 15, y);
  }
  ctx.fillStyle = '#16E6FF';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(`${name} ${scrobs}${scrobnum}%]`, x * 100 + 15, y);
  }
}

function drawBaseName(ctx, name, x, y) {
  ctx.fillStyle = 'white';
  for (let i = 0; i < 4; i++) {
    ctx.fillText(name, x * 100 + 15, y);
  }
}

function generateStatsText(authorId, sum, total, avg2, avg, newalbs, crowncount, num_missing) {
  const chartCoverage = parseFloat(parseFloat((parseFloat(sum) / total) * 100).toFixed(2));
  let stats = `★ ${sum} / ${total} scrobbles ★\n`;
  stats += `★ ${avg2} / ${avg} scrobbles per day ★\n`;
  stats += `★ ${chartCoverage}% chart coverage ★\n`;
  stats += `★ ${newalbs} ${newalbs === 1 ? 'new album' : 'new albums'} ★\n`;
  stats += `★ ${crowncount} ${crowncount === 1 ? 'crown' : 'crowns'} ★`;
  
  if (authorId === '435000596165165057') {
    stats += `\n★ ${num_missing} missing album covers 🤔 ★`;
  }
  
  return stats;
}

async function processQueues(client, message, period) {
  const fetchUser = new fetchuser(client, message);
  const user = await fetchUser.username();
  if (!user) {
    console.error('No Last.fm username found for queue processing');
    return;
  }

  const albumArray = [];
  const artistArray = [];
  let page = message.content.split(' ')[1] || '1';
  
  // Get guild members
  const guildMembers = await message.guild.members.fetch();
  const gIDs = Array.from(guildMembers.keys()).join(',');
  const gUsers = Array.from(guildMembers.values()).map(m => m.user.username).join('~,~');

  // Determine how many pages to fetch based on guild
  const maxPages = (message.guild.id === '447838857606463489' || message.guild.id === '671074176622264320') ? Infinity : 5;
  
  try {
    const lib = new Library(client.config.lastFM.apikey);
    let i = -1;
    
    while (true) {
      i++;
      if (i >= maxPages) break;

      const data = await lib.user.getTopAlbums(user, period, 250, parseInt(page) + i);
      const { album } = data.topalbums;
      
      const prevLength = albumArray.length;
      album.forEach(a => {
        artistArray.push(a.artist.name);
        albumArray.push(a.name);
      });
      
      if (prevLength === albumArray.length) break;
      await sleep(10000);
    }

    console.log(`Processing queues for ${artistArray.length} artists/albums`);

    // Import models
    const ArtistQueue = client.sequelize.import('../models/ArtistQueue.js');
    const AlbumQueue = client.sequelize.import('../models/AlbumQueue.js');
    const Crowns = client.sequelize.import('../models/Crowns.js');
    const ACrowns = client.sequelize.import('../models/ACrowns.js');

    let artistQueueCount = 0;
    let albumQueueCount = 0;

    // Process each artist/album pair
    for (let i = 0; i < artistArray.length; i++) {
      try {
        // Check and create artist queue entry
        const artistExists = await ArtistQueue.findOne({
          where: {
            guildID: message.guild.id,
            artistName: artistArray[i]
          }
        });

        if (!artistExists) {
          const crownExists = await Crowns.findOne({
            where: {
              guildID: message.guild.id,
              artistName: artistArray[i]
            }
          });

          const lfmUsername = crownExists ? await fetchUser.usernameFromId(crownExists.userID) : '';
          const crownPlays = crownExists ? crownExists.artistPlays : '0';

          await ArtistQueue.create({
            guildID: message.guild.id,
            guildName: message.guild.name,
            guildUserIDs: gIDs,
            guildUsers: gUsers,
            userID: message.member.id,
            userName: message.member.user.username,
            artistName: artistArray[i],
            chartType: period.substring(0, 1),
            crownHolder: lfmUsername,
            crownPlays: crownPlays
          });
          artistQueueCount++;
        }

        // Check and create album queue entry
        const albumExists = await AlbumQueue.findOne({
          where: {
            guildID: message.guild.id,
            artistName: artistArray[i],
            albumName: albumArray[i]
          }
        });

        if (!albumExists) {
          const albumCrownExists = await ACrowns.findOne({
            where: {
              guildID: message.guild.id,
              artistName: artistArray[i],
              albumName: albumArray[i]
            }
          });

          const lfmUsername = albumCrownExists ? await fetchUser.usernameFromId(albumCrownExists.userID) : '';
          const crownPlays = albumCrownExists ? albumCrownExists.albumPlays : '0';

          await AlbumQueue.create({
            guildID: message.guild.id,
            guildName: message.guild.name,
            guildUserIDs: gIDs,
            guildUsers: gUsers,
            userID: message.member.id,
            userName: message.member.user.username,
            artistName: artistArray[i],
            albumName: albumArray[i],
            chartType: period.substring(0, 1),
            crownHolder: lfmUsername,
            crownPlays: crownPlays
          });
          albumQueueCount++;
        }
      } catch (e) {
        console.error(`Error processing queue entry ${i}:`, e);
        // Continue with next entry even if one fails
        continue;
      }
    }

    console.log(`Queue processing complete. Added ${artistQueueCount} artists and ${albumQueueCount} albums to queues.`);

  } catch (e) {
    console.error('Error processing queues:', e);
    // Emit command error event for proper logging
    client.emit('commandError', 'queue', e, message);
  }
}

async function generateChart(client, message, args, periodKey) {
  const lib = new Library(client.config.lastFM.apikey);
  const fetchUser = new fetchuser(client, message);
  const ACrowns = client.sequelize.import('../models/ACrowns.js');
  const periodConfig = PERIODS[periodKey];
  
  let vals = periodKey === 'weekly' ? ['5', '6'] : ['5', '10'];
  let [x, y] = [parseInt(vals[0]), parseInt(vals[1])];
  let trial = 0;
  let chartSuccess = false;

  while (trial < 3) {
    try {
      const user = await fetchUser.username();
      if (!user) return message.reply(client.snippets.noLogin);
      message.react('✅');

      // Get page number and data
      let page = args.join(' ');
      let data;
      if (!page || parseInt(page) <= 0) {
        page = '1';
        data = await lib.user.getTopAlbums(user, periodConfig.period, periodKey === 'weekly' ? '30' : '50', '1');
      } else {
        data = await lib.user.getTopAlbums(user, periodConfig.period, periodKey === 'weekly' ? '30' : '50', page);
      }

      // Calculate date range
      const date = parseInt(Math.floor(Date.now() / 1000));
      let date2;
      let total, avg;

      if (periodConfig.period === 'overall') {
        const userData = await lib.user.getInfo(user);
        date2 = parseInt(userData.user.registered['#text']);
      } else {
        date2 = date - periodConfig.seconds;
      }

      const tracks = await lib.user.getRecentTracks(user, 1, 1, date2, date);
      total = parseFloat(tracks.recenttracks['@attr'].total);
      avg = parseFloat((total / (periodConfig.seconds ? periodConfig.seconds / 86400 : (date - date2) / 86400)).toFixed(2));

      // Generate chart image and stats
      const { buffer, stats } = await generateChartImage(client, message, data, {
        x, y, total, avg, date, date2,
        ACrowns, lib, fetchUser, user
      });

      // Create and send embed
      const name = await fetchUser.usernameFromId(message.author.id);
      const embed = new MessageEmbed()
        .setAuthor(
          `${periodConfig.title} Chart (Page #${page})`,
          message.author.displayAvatarURL(),
          `https://www.last.fm/user/${name}/library/albums?date_preset=${periodConfig.url_preset}&page=${page}`
        )
        .setDescription(stats)
        .attachFiles([buffer]);

      try {
        embed.setColor(message.member.displayColor);
      } catch (e) {
        console.log(e);
      }

      await message.channel.send({ embed });
      chartSuccess = true;
      break;

    } catch (e) {
      console.error(e);
      const attempt_num = trial + 1;
      await message.channel.send(`An error occurred. Trying again... (Attempt ${attempt_num}/3)`);
      trial++;
    }
  }

  // Process queues regardless of chart generation success
  try {
    await processQueues(client, message, periodConfig.period);
  } catch (e) {
    console.error('Failed to process queues:', e);
    client.emit('commandError', 'queue', e, message);
  }
}

module.exports = {
  generateChart,
  PERIODS
}; 