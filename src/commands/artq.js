const { MessageEmbed } = require(`discord.js`);
const { fetchuser } = require(`../utils/fetchuser`);
const Library = require(`../lib/index.js`);
const { Op } = require(`sequelize`);
const ReactionInterface = require(`../utils/ReactionInterface`);
const { processQueue } = require(`../utils/queueProcessor`);
const sortingFunc = (a, b) => parseInt(b.plays) - parseInt(a.plays);
require('events').EventEmitter.defaultMaxListeners = 20;
let unique = new Set();
let period;

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
};

function calcTime(offset) {

	// create Date object for current location
	d = new Date();

	// convert to msec
	// add local time zone offset 
	// get UTC time in msec
	utc = d.getTime() + (d.getTimezoneOffset() * 60000);

	return new Date(utc + (3600000 * offset));

}

exports.run = async (client, message, args) => {
	const lib = new Library(client.config.lastFM.apikey);
	const fetchUser = new fetchuser(client, message);
	const ArtistQueue = client.sequelize.import(`../models/ArtistQueue.js`);
	const Time = client.sequelize.import(`../models/Time.js`);
	const TotalsAndAvgs = client.sequelize.import(`../models/TotalsAndAvgs.js`);
	const ACrowns = client.sequelize.import(`../models/ACrowns.js`);
	const Crowns = client.sequelize.import(`../models/Crowns.js`);
	const Users = client.sequelize.import(`../models/Users.js`);

	// Error logging function that sends to both console and error channel
	async function logError(error, context = '') {
		console.error(error);
		try {
			const errorChannel = client.channels.cache.get('1350524158915776604');
			if (errorChannel) {
				const errorMessage = `❌ Error in Artist Queue${context ? ` (${context})` : ''}:\n\`\`\`\n${error.stack || error}\n\`\`\``;
				await errorChannel.send(errorMessage);
			}
		} catch (e) {
			console.error('Failed to log error to channel:', e);
		}
	}

	try {
		var artistList = await ArtistQueue.findAll();
		var artistLength = artistList.length;
		var thread = getRandomInt(1, 1000000);
		var arguments = [`--r`, `r`, `--s`, `--start`, `--run`, `--pages`, `--lr`, `--rl`];

		var timeAvgFetch = await TotalsAndAvgs.findAll();
		if (!timeAvgFetch || timeAvgFetch.length === 0) {
			// Initialize with default values if no record exists
			await TotalsAndAvgs.create({
				id: 1,
				totalArtists: 0,
				totalAlbums: 0,
				artistAvg: 0,
				albumAvg: 0
			});
			timeAvgFetch = await TotalsAndAvgs.findAll();
		}

		var TOTAL_ARTISTS = parseInt(timeAvgFetch[0].totalArtists);
		var ARTIST_AVG = parseFloat(timeAvgFetch[0].artistAvg).toFixed(2);
		ARTIST_AVG *= 1000;


		var TOTAL_ALBUMS = parseInt(timeAvgFetch[0].totalAlbums);
		var ALBUM_AVG = parseFloat(timeAvgFetch[0].albumAvg).toFixed(2);
		ALBUM_AVG *= 1000;


		if (artistLength == 0 && args[0] == `--pages`) {
			return message.reply(`the artist crown queue is currently empty.`);
		}

		if (args[0] != `--r` || message.member.id != `175199958314516480`) {
			try {
				var timeList = await Time.findAll();
				var checkedGuilds = [];
				var sums = [];
				var avgs = [];
				var count = [];
				var weight = [];
				var totalArtists = 0;
				var totalArtistsSum = 0;
				var totalArtistsAvg = 0;
				var global_count = [];
				if (timeList.length > 0 && timeList.length < 1000) {
					for (var i = 0; i < timeList.length; i++) {
						//console.log(i);
						if (timeList[i].isArtist == `true`) {
							totalArtists++;
							totalArtistsSum += parseFloat(timeList[i].ms);
							if (!checkedGuilds.includes(timeList[i].guildID)) {
								var counter = 0;
								for (var j = 0; j < timeList.length; j++) {
									if (timeList[j].guildID == timeList[i].guildID && timeList[j].isArtist == `true`) {
										if (counter == 0) {
											sums.push(parseFloat(timeList[j].ms));
											count.push(1);

											counter += 1;
										}
										else {
											sums[sums.length - 1] += parseFloat(timeList[j].ms);
											count[count.length - 1] += 1;
										}
									}
								}
								checkedGuilds.push(timeList[i].guildID);
							}
						}
					}
				}
				else if (timeList.length >= 1000) {
					var addedArtists = 0;
					var addedArtistsSum = 0;
					var addedAlbums = 0;
					var addedAlbumsSum = 0;
					var preservedIDs = [];
					var artistGuilds = [];
					var albumGuilds = [];


					var timeMap = timeList
						.map(x => {
							return {
								id: x.get(`id`),
								isArtist: x.get(`isArtist`),
								isAlbum: x.get(`isAlbum`),
								guildID: x.get(`guildID`),
								ms: x.get(`ms`)
							};
						})
						.sort((a, b) => (parseInt(b.ms) - getRandomInt(1, parseInt(b.ms) * 2)));

					for (var i = 0; i < timeMap.length; i++) {
						if (timeMap[i].isArtist == `true`) {
							if (artistGuilds.includes(timeMap[i].guildID)) {
								addedArtists += 1;
								addedArtistsSum += parseFloat(timeMap[i].ms);
							}
							else {
								artistGuilds.push(timeMap[i].guildID);
								preservedIDs.push(timeMap[i].id);
							}
						}
						if (timeMap[i].isAlbum == `true`) {
							if (albumGuilds.includes(timeMap[i].guildID)) {
								addedAlbums += 1;
								addedAlbumsSum += parseFloat(timeMap[i].ms);
							}
							else {
								albumGuilds.push(timeMap[i].guildID);
								preservedIDs.push(timeMap[i].id);
							}
						}

						if (!preservedIDs.includes(timeMap[i].id)) {
							await Time.destroy({
								where: {
									id: timeMap[i].id
								}
							});
						}

					}

					var newArtistTotal = TOTAL_ARTISTS + addedArtists;
					var newAlbumTotal = TOTAL_ALBUMS + addedAlbums;

					var newArtistAvg = parseFloat((((TOTAL_ARTISTS * ARTIST_AVG) + addedArtistsSum) / newArtistTotal) / 1000).toFixed(15);
					var newAlbumAvg = parseFloat((((TOTAL_ALBUMS * ALBUM_AVG) + addedAlbumsSum) / newAlbumTotal) / 1000).toFixed(15);

					TOTAL_ARTISTS = newArtistTotal;
					TOTAL_ALBUMS = newAlbumTotal;


					await TotalsAndAvgs.update({
						totalArtists: newArtistTotal,
						totalAlbums: newAlbumTotal,
						artistAvg: newArtistAvg,
						albumAvg: newAlbumAvg
					},
						{
							where: {
								id: 1
							}
						});
				}

				var relevantGuilds = [];
				var relevantSums = [];
				var relevantCount = [];
				var weightCount = [];
				for (var i = 0; i < checkedGuilds.length; i++) {
					var counter = 0;

					for (y = 0; y < artistList.length; y++) {
						if (checkedGuilds[i] == artistList[y].guildID) {

							if (counter == 0) {
								relevantGuilds.push(checkedGuilds[i]);
								relevantSums.push(sums[i]);
								relevantCount.push(count[i]);
								weightCount.push(1);
								counter += 1;
							}
							else {
								weightCount[weightCount.length - 1] += 1;

							}
						}
					}
				}

				for (var i = 0; i < relevantGuilds.length; i++) {
					avgs.push(parseFloat(relevantSums[i]) / parseFloat(relevantCount[i]));
					weight.push(parseFloat(weightCount[i]) / parseFloat(artistList.length));
				}

				/*
				for(var i = 0; i < checkedGuilds.length; i++){
					//console.log(i);
					avgs.push(parseFloat(sums[i])/parseFloat(count[i]));	
					weight.push(parseFloat(count[i])/parseFloat(timeList.length));
				)
				*/

				var time_avg = 0;
				for (var i = 0; i < relevantGuilds.length; i++) {
					time_avg += parseFloat(avgs[i] * weight[i] / 1000)
					//console.log(time_avg);
				}

				var minutes = false;
				time_avg = parseFloat(time_avg.toFixed(2));
				var total_minutes = false;

				totalArtistsSum += (ARTIST_AVG * TOTAL_ARTISTS);
				totalArtists += TOTAL_ARTISTS;
				totalArtistsAvg = parseFloat(totalArtistsSum / totalArtists / 1000)
				totalArtistsAvg = parseFloat(totalArtistsAvg.toFixed(2));

				//console.log(count);
				//console.log(avgs);

				if (minutes) {
					var eta = parseFloat(((artistLength * time_avg) / 60).toFixed(2));
				}
				else {
					var eta = parseFloat(((artistLength * time_avg) / 60 / 60).toFixed(2));
				}
				var totalProcessingTime = parseFloat(((totalArtistsSum) / 1000 / 60 / 60 / 24).toFixed(2));

			}
			catch (e) {
				await logError(e, 'time calculation');
				return;
			}

			var ARTIST_AVG_DISPLAY = (ARTIST_AVG / 1000).toFixed(2);
			var x = 0;
			var description = artistList
				.slice(0, 10)
				.map(k => `${++x}. **${k.artistName}**\n${k.guildName} | ${k.userName} - ${k.chartType} ${k.crownHolder != `` ? `| :crown: [` + k.crownHolder + `](https://www.last.fm/user/` + k.crownHolder + `) (` + k.crownPlays + `) :crown:` : ``}`)
				.join(`\n`);
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setTitle(`**Artist Crown Queue**`)
				.setDescription(description)
				.setFooter(artistLength + ` artists in queue | ${artistLength == 0 ? `0` : time_avg} ${minutes == true ? `min/artist` : `sec/artist`} | ~` + eta + ` hours until complete\n` +
					totalArtists + ` total artists processed | ` + ARTIST_AVG_DISPLAY + ` ${total_minutes == true ? `min/artist` : `sec/artist`} | ~` + totalProcessingTime + ` days spent processing`, `https://i.imgur.com/ysyfHk7.gif`)
			//.setTimestamp();
			var msg = await message.channel.send({ embed });


			var global_page = 1;
			var global_offset = 0;
			if (artistList.length > 10 && args[0] != `--live`) {
				const rl = new ReactionInterface(msg, message.author);
				const length = Math.ceil(artistList.length / 10);
				let offset = 0, page = 1;
				const func = async off => {
					let num = off;
					const description = artistList
						.slice(off, off + 10)
						.map(k => `${++num}. **${k.artistName}**\n${k.guildName} | ${k.userName} - ${k.chartType} ${k.crownHolder != `` ? `| :crown: [` + k.crownHolder + `](https://www.last.fm/user/` + k.crownHolder + `) (` + k.crownPlays + `) :crown:` : ``}`)
						.join(`\n`);
					const embed = new MessageEmbed()
						.setColor(message.member.displayColor)
						.setTitle(`**Artist Crown Queue**`)
						.setDescription(description)
						.setFooter(artistLength + ` artists in queue | ${artistLength == 0 ? `0` : time_avg} ${minutes == true ? `min/artist` : `sec/artist`} | ~` + eta + ` hours until complete\n` +
							totalArtists + ` total artists processed | ` + totalArtistsAvg + ` ${total_minutes == true ? `min/artist` : `sec/artist`} | ~` + totalProcessingTime + ` days spent processing`, `https://i.imgur.com/ysyfHk7.gif`)
					await msg.edit({ embed });
				};
				const toFront = () => {
					if (page !== length) {
						offset += 10, page++;
						global_page++;
						global_offset += 10;
						func(offset);
					}
				};
				const toBack = () => {
					if (page !== 1) {
						offset -= 10, page--;
						global_page++;
						global_offset -= 10;
						func(offset);
					}
				};
				await rl.setKey(client.snippets.arrowLeft, toBack);
				await rl.setKey(client.snippets.arrowRight, toFront);
			}
		}
		if (arguments.includes(args[0]) && message.member.id == `175199958314516480` && args[0] != `--pages` && args[0] != `--live`) {
			message.channel.send(`starting artist crown queue...\n\`` + artistLength + `\` artist crowns to process.`);
		}
		if (args[0] === '--r' && message.member.id === '175199958314516480') {
			async function processArtist(currentArtist) {
				try {
					const Notifs = client.sequelize.import(`../models/Notifs.js`);
					const WNotifs = client.sequelize.import(`../models/WNotifs.js`);
					const ArtistRecord = client.sequelize.import(`../models/ArtistRecord.js`);

					const threadPrefix = `[${currentArtist.artistName}]`;
					let statusMsg = await message.channel.send(`${threadPrefix} Processing...`);

					// Get all valid user IDs (excluding bots) in a single array
					const gIDs = currentArtist.guildUserIDs.split(`,`);
					const gUsers = currentArtist.guildUsers.split(`~,~`);
					const botNames = ['UB3R-B0T', 'Tatsu', 'MonitoRSS', '.fmbot', 'JeopardyBot', 'Chuu', 'FMdaily', 'Untappdiscord', 
									'Gamebot', 'Starboard', 'SnipeBot', 'GitBot', 'play-jeopardy', 'Elimina', 'FMcord Beta', 
									'Banner Boi', 'Filmlinkd', 'the new fm', 'Snipe', 'makar fm', 'Readybot.io', 'feed1_dev', 'jeopardy!'];
					const validUserIDs = gIDs.filter((id, index) => !botNames.includes(gUsers[index]));

					// Fetch all users and their Last.fm usernames in one query
					const users = await Users.findAll({
						where: {
							discordUserID: {
								[Op.in]: validUserIDs
							}
						},
						attributes: ['discordUserID', 'lastFMUsername']
					});

					const data = await lib.artist.getInfo(currentArtist.artistName);
					if (!data || !data.artist) {
						throw new Error(`Failed to get artist info from Last.fm for ${currentArtist.artistName}`);
					}

					const hasCrown = await Crowns.findOne({
						where: {
							guildID: currentArtist.guildID,
							artistName: data.artist.name
						}
					});

					let origKing = ``;
					let origKingPlays = ``;
					let origKingUser = ``;
					if (hasCrown != null) {
						origKing = hasCrown.userID;
					}

					let total = 0;
					let listeners = 0;

					// Get artist info for all users in parallel
					const userPlaycounts = await Promise.all(
						users.map(async user => {
							try {
								const req = await lib.artist.getInfo(currentArtist.artistName, user.lastFMUsername);
								if (!req.artist || !req.artist.stats.userplaycount) return null;

								const plays = parseInt(req.artist.stats.userplaycount);
								if (plays === 0) return null;

								if (user.discordUserID === origKing) {
									origKingPlays = plays.toString();
									origKingUser = user.lastFMUsername;
								}

								total += plays;
								listeners++;

								return {
									name: gUsers[gIDs.indexOf(user.discordUserID)],
									userID: user.discordUserID,
									plays: plays.toString()
								};
							} catch (error) {
								await logError(error, `${threadPrefix} Last.fm API request for ${user.lastFMUsername}`);
								return null;
							}
						})
					);

					// Filter out null results and sort by plays
					const know = userPlaycounts.filter(result => result !== null);
					const sorted = know.sort(sortingFunc)[0];

					if (hasCrown === null && sorted && sorted.plays !== `0`) {
						await Crowns.create({
							guildID: currentArtist.guildID,
							userID: sorted.userID,
							artistName: data.artist.name,
							artistPlays: sorted.plays,
							serverPlays: total,
							serverListeners: listeners,
							artistURL: data.artist.url
						});
					}
					else if (hasCrown !== null && sorted) {
						const userID = hasCrown.userID;
						const isUser = await Users.findOne({
							where: {
								[Op.or]: [{ discordUserID: userID }, { discordUserID: sorted.userID }]
							}
						});

						await Crowns.update({
							serverPlays: total,
							serverListeners: listeners,
							artistURL: data.artist.url
						}, {
							where: {
								guildID: currentArtist.guildID,
								artistName: data.artist.name
							}
						});

						if (!gIDs.includes(origKing) || parseInt(sorted.plays) > parseInt(hasCrown.artistPlays)) {
							await Crowns.update({
								userID: sorted.userID,
								artistPlays: sorted.plays
							}, {
								where: {
									guildID: currentArtist.guildID,
									artistName: data.artist.name
								}
							});

							// Handle notifications
							const notifiable = await Notifs.findOne({ where: { userID: userID } });
							if (notifiable && isUser) {
								client.emit(`crownTaken`, {
									prevOwner: userID,
									newOwner: sorted.userID,
									guild: currentArtist.guildName,
									artist: data.artist.name
								});
							}

							const notifiableW = await WNotifs.findOne({ where: { userID: sorted.userID } });
							if (notifiableW && isUser) {
								client.emit(`crownWon`, {
									prevOwner: userID,
									newOwner: sorted.userID,
									guild: currentArtist.guildName,
									artist: data.artist.name
								});
							}
						}
					}

					// Record processing time
					const processingTime = Date.now();
					await Time.create({
						ms: processingTime.toString(),
						isAlbum: 'false',
						isArtist: 'true',
						guildID: currentArtist.guildID
					});

					// Update artist record
					if (hasCrown) {
						const newHolder = await fetchUser.usernameFromId(hasCrown.userID);
						await ArtistRecord.create({
							artistName: data.artist.name,
							guildName: currentArtist.guildName,
							prevOwner: currentArtist.crownHolder,
							newOwner: newHolder,
							prevPlays: currentArtist.crownPlays,
							newPlays: hasCrown.artistPlays
						});
					}

					// Update final status message
					const remainingCount = (await ArtistQueue.findAll()).length;
					await statusMsg.edit(
						`${threadPrefix}\n` +
						`👥 Server: ${currentArtist.guildName}\n` +
						`👑 Previous Crown: ${currentArtist.crownHolder || 'None'} (${currentArtist.crownPlays || '0'} plays)\n` +
						`📊 Processed ${users.length} users | ${listeners} listeners | ${total} total plays\n` +
						`${sorted ? `👑 New Crown: ${sorted.name} (${sorted.plays} plays)\n` : ''}` +
						`📝 Remaining in queue: ${remainingCount}`
					);

				} catch (error) {
					await logError(error, `${threadPrefix} processing ${currentArtist.artistName}`);
					throw error;
				}
			}

			// Start the queue processor with error logging
			processQueue({
				queueModel: ArtistQueue,
				processItem: processArtist,
				logToChannel: async (msg) => {
					try {
						await message.channel.send(msg);
					} catch (err) {
						await logError(err, 'sending queue message');
					}
				},
				itemType: 'artist',
				client
			}).catch(async err => {
				await logError(err, 'queue processor crash');
				await message.channel.send(`💥 Queue processor crashed. Check error logs for details. Restarting in 1 minute...`);
				await sleep(60000);
				processQueue({
					queueModel: ArtistQueue,
					processItem: processArtist,
					logToChannel,
					itemType: 'artist',
					client
				});
			});
		}
	}
	catch (e) {
		console.error(e);
	}
};

exports.help = {
	name: `artq`,
	description: `**ART**IST **Q**UEUE: check the artist queue`,
	usage: `only the bot owner can run the queue and use a live queue`
};