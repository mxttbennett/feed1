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

exports.run = async (client, message, args) => {
	const lib = new Library(client.config.lastFM.apikey);
	const fetchUser = new fetchuser(client, message);
	const AlbumQueue = client.sequelize.import(`../models/AlbumQueue.js`);
	const Time = client.sequelize.import(`../models/Time.js`);
	const TotalsAndAvgs = client.sequelize.import(`../models/TotalsAndAvgs.js`);
	const ACrowns = client.sequelize.import(`../models/ACrowns.js`);
	const Users = client.sequelize.import(`../models/Users.js`);

	// Error logging function that sends to both console and error channel
	async function logError(error, context = '') {
		console.error(error);
		try {
			const errorChannel = client.channels.cache.get('1350524158915776604');
			if (errorChannel) {
				const errorMessage = `❌ Error in Album Queue${context ? ` (${context})` : ''}:\n\`\`\`\n${error.stack || error}\n\`\`\``;
				await errorChannel.send(errorMessage);
			}
		} catch (e) {
			console.error('Failed to log error to channel:', e);
		}
	}

	try {
		var albumList = await AlbumQueue.findAll();
		var albumLength = albumList.length;
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


		if (albumLength == 0 && args[0] == `--pages`) {
			return message.reply(`the album crown queue is currently empty.`);
		}

		if (args[0] != `--r` || message.member.id != `175199958314516480`) {
			try {
				var timeList = await Time.findAll();
				var checkedGuilds = [];
				var sums = [];
				var avgs = [];
				var count = [];
				var weight = [];
				var totalAlbums = 0;
				var totalAlbumsSum = 0;
				var totalAlbumsAvg = 0;
				if (timeList.length > 0 && timeList.length < 1000) {
					for (var i = 0; i < timeList.length; i++) {
						if (timeList[i].isAlbum == `true`) {
							totalAlbums++;
							totalAlbumsSum += parseFloat(timeList[i].ms);
							if (!checkedGuilds.includes(timeList[i].guildID)) {
								var counter = 0;
								for (var j = 0; j < timeList.length; j++) {
									if (timeList[j].guildID == timeList[i].guildID && timeList[j].isAlbum == `true`) {
										if (counter == 0) {
											sums.push(parseFloat(timeList[j].ms));
											counter++;
											count.push(1);

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

					for (y = 0; y < albumList.length; y++) {
						if (checkedGuilds[i] == albumList[y].guildID) {

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
					weight.push(parseFloat(weightCount[i]) / parseFloat(albumList.length));
				}

				var time_avg = 0;
				for (var i = 0; i < relevantGuilds.length; i++) {
					time_avg += parseFloat(avgs[i] * weight[i] / 1000);
				}

				totalAlbumsSum += (ALBUM_AVG * TOTAL_ALBUMS);
				totalAlbums += TOTAL_ALBUMS;
				totalAlbumsAvg = parseFloat(totalAlbumsSum / totalAlbums / 1000)

				var totalProcessingTime = parseFloat(((totalAlbumsSum) / 1000 / 60 / 60 / 24).toFixed(2));

				var minutes = false;
				time_avg = parseFloat(time_avg.toFixed(2));


				if (minutes) {
					var eta = parseFloat(((albumLength * time_avg) / 60).toFixed(2));
				}
				else {
					var eta = parseFloat(((albumLength * time_avg) / 60 / 60).toFixed(2));
				}

				var total_minutes = false;
				if (totalAlbumsAvg >= 60) {
					totalAlbumsAvg = parseFloat((totalAlbumsAvg / 60).toFixed(2));
					total_minutes = true;
				}
				else {
					totalAlbumsAvg = parseFloat(totalAlbumsAvg.toFixed(2));
				}

			}
			catch (e) {
				await logError(e, 'time calculation');
				return;
			}

			var ALBUM_AVG_DISPLAY = (ALBUM_AVG / 1000).toFixed(2);
			var x = 0;
			var description = albumList
				.slice(0, 10)
				.map(k => `${++x}. __${k.artistName}__ — ***${k.albumName}***\n${k.guildName} | ${k.userName} - ${k.chartType} ${k.crownHolder != `` ? `| :crown: [` + k.crownHolder + `](https://www.last.fm/user/` + k.crownHolder + `) (` + k.crownPlays + `) :crown:` : ``}`)
				.join(`\n`);
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setTitle(`**Album Crown Queue**`)
				.setDescription(description)
				.setFooter(albumLength + ` albums in queue | ${albumLength == 0 ? `0` : time_avg} sec/album | ~` + eta + ` hours until complete\n` +
					totalAlbums + ` total albums processed | ` + ALBUM_AVG_DISPLAY + ` sec/album | ~` + totalProcessingTime + ` days spent processing`, `https://i.imgur.com/ysyfHk7.gif`);
			//.setTimestamp();
			var msg = await message.channel.send({ embed });


			var global_page = 1;
			var global_offset = 0;
			if (albumList.length > 10 && args[0] != `--live`) {
				const rl = new ReactionInterface(msg, message.author);
				const length = Math.ceil(albumList.length / 10);
				let offset = 0, page = 1;
				const func = async off => {
					let num = off;
					const description = albumList
						.slice(off, off + 10)
						.map(k => `${++num}. __${k.artistName}__ — ***${k.albumName}***\n${k.guildName} | ${k.userName} - ${k.chartType} ${k.crownHolder != `` ? `| :crown: [` + k.crownHolder + `](https://www.last.fm/user/` + k.crownHolder + `) (` + k.crownPlays + `) :crown:` : ``}`)
						.join(`\n`);
					const embed = new MessageEmbed()
						.setColor(message.member.displayColor)
						.setTitle(`**Album Crown Queue**`)
						.setDescription(description)
						.setFooter(albumLength + ` albums in queue | ${albumLength == 0 ? `0` : time_avg} ${minutes == true ? `min/album` : `sec/album`} | ~` + eta + ` hours until complete\n` +
							totalAlbums + ` total albums processed | ` + totalAlbumsAvg + ` sec/album | ` + totalProcessingTime + ` days spent processing`, `https://i.imgur.com/ysyfHk7.gif`)
					//.setTimestamp();
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
		//console.log(`hhdf`);
		if (arguments.includes(args[0]) && message.member.id == `175199958314516480` && args[0] != `--pages` && args[0] != `--live`) {
			message.channel.send(`starting album crown queue...\n\`` + albumLength + `\` album crowns to process.`);
		}

		var msg_trip = 0;
		var msg = ``;
		if (args[0] === '--r' && message.member.id === '175199958314516480') {
			async function logToChannel(msg) {
				try {
					await message.channel.send(msg);
				} catch (err) {
					await logError(err, 'sending log message');
				}
			}

			async function processAlbum(currentAlbum) {
				try {
					const ACrowns = client.sequelize.import(`../models/ACrowns.js`);
					const Albums = client.sequelize.import(`../models/Albums.js`);
					const Notifs = client.sequelize.import(`../models/Notifs.js`);
					const WNotifs = client.sequelize.import(`../models/WNotifs.js`);
					const AlbumRecord = client.sequelize.import(`../models/AlbumRecord.js`);

					const threadPrefix = `[${currentAlbum.artistName} - ${currentAlbum.albumName}]`;

					// Debug log album info
					await logToChannel(`${threadPrefix} 🔍 Processing album`);

					const hasCrown = await ACrowns.findOne({
						where: {
							guildID: currentAlbum.guildID,
							artistName: currentAlbum.artistName,
							albumName: currentAlbum.albumName
						}
					});

					// Debug log crown check
					await logToChannel(`${threadPrefix} 👑 Existing crown check: ${hasCrown ? 'Found' : 'Not found'}`);

					var origKing = ``;
					var origKingPlays = ``;
					var origKingUser = ``;
					if (hasCrown != null) {
						origKing = hasCrown.userID;
					}

					var total = 0;
					var listeners = 0;
					var gIDs = currentAlbum.guildUserIDs.split(`,`);
					var gUsers = currentAlbum.guildUsers.split(`~,~`);

					// Filter out known bot accounts
					const botNames = ['UB3R-B0T', 'Tatsu', 'MonitoRSS', '.fmbot', 'JeopardyBot', 'Chuu', 'FMdaily', 'Untappdiscord', 
									'Gamebot', 'Starboard', 'SnipeBot', 'GitBot', 'play-jeopardy', 'Elimina', 'FMcord Beta', 
									'Banner Boi', 'Filmlinkd', 'the new fm', 'Snipe', 'makar fm', 'Readybot.io', 'feed1_dev', 'jeopardy!'];

					// Get all valid user IDs (excluding bots) in a single array
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

					// Debug log user processing results
					await logToChannel(`${threadPrefix} 📊 Processing results:\n- Total plays: ${total}\n- Listeners: ${listeners}\n- Valid users processed: ${users.length}`);

					// Log the list of Last.fm usernames being checked
					const sortedUsernames = users.map(u => u.lastFMUsername).sort();
					await logToChannel(`${threadPrefix} 🔍 Checking Last.fm usernames:\n${sortedUsernames.join(', ')}`);

					let albumUrl = '';  // Store the first valid album URL we find

					// Get album info for all users in parallel
					const userPlaycounts = await Promise.all(
						users.map(async user => {
							try {
								const req = await lib.album.getInfo(currentAlbum.artistName, currentAlbum.albumName, user.lastFMUsername);
								if (!req.album || !req.album.userplaycount) {
									return null;
								}

								const plays = parseInt(req.album.userplaycount);
								if (plays === 0) {
									return null;
								}

								// Store album URL from the first valid response
								if (!albumUrl && req.album.url) {
									albumUrl = req.album.url;
								}

								// Track original crown holder's plays
								if (user.discordUserID === origKing) {
									origKingPlays = plays.toString();
									origKingUser = user.lastFMUsername;
									await logToChannel(`${threadPrefix} 👑 Original crown holder ${origKingUser} has ${origKingPlays} plays`);
								}

								total += plays;
								listeners++;

								return {
									name: gUsers[gIDs.indexOf(user.discordUserID)],
									userID: user.discordUserID,
									plays: plays.toString()
								};
							} catch (error) {
								await logError(error, `Last.fm API request for ${user.lastFMUsername} - ${currentAlbum.artistName} - ${currentAlbum.albumName}`);
								return null;
							}
						})
					);

					// Filter out null results and sort by plays
					const know = userPlaycounts.filter(result => result !== null);
					const sorted = know.sort(sortingFunc)[0];

					// Debug log sorted results
					if (sorted) {
						await logToChannel(`${threadPrefix} 📈 Top listener: ${sorted.name} with ${sorted.plays} plays`);
					} else {
						await logToChannel(`${threadPrefix} ⚠️ No valid listeners found`);
					}

					if (hasCrown === null && sorted && sorted.plays !== `0`) {
						await logToChannel(`${threadPrefix} 👑 Creating new crown for ${sorted.name}`);
						await ACrowns.create({
							guildID: currentAlbum.guildID,
							userID: sorted.userID,
							artistName: currentAlbum.artistName,
							albumName: currentAlbum.albumName,
							albumPlays: sorted.plays,
							serverPlays: total,
							serverListeners: listeners,
							albumURL: albumUrl
						});
						await logToChannel(`${threadPrefix} ✅ Crown created successfully`);
					}
					else if (hasCrown !== null && sorted) {
						const userID = hasCrown.userID;
						const isUser = await Users.findOne({
							where: {
								[Op.or]: [{ discordUserID: userID }, { discordUserID: sorted.userID }]
							}
						});

						await ACrowns.update({
							serverPlays: total,
							serverListeners: listeners,
							albumURL: albumUrl
						}, {
							where: {
								guildID: currentAlbum.guildID,
								artistName: currentAlbum.artistName,
								albumName: currentAlbum.albumName
							}
						});

						if (!gIDs.includes(origKing) || parseInt(sorted.plays) > parseInt(hasCrown.albumPlays)) {
							await ACrowns.update({
								userID: sorted.userID,
								albumPlays: sorted.plays
							}, {
								where: {
									guildID: currentAlbum.guildID,
									artistName: currentAlbum.artistName,
									albumName: currentAlbum.albumName
								}
							});

							// Handle notifications
							const notifiable = await Notifs.findOne({ where: { userID: userID } });
							if (notifiable && isUser) {
								client.emit(`crownTaken`, {
									prevOwner: userID,
									newOwner: sorted.userID,
									guild: currentAlbum.guildName,
									artist: currentAlbum.artistName,
									album: currentAlbum.albumName
								});
							}

							const notifiableW = await WNotifs.findOne({ where: { userID: sorted.userID } });
							if (notifiableW && isUser) {
								client.emit(`crownWon`, {
									prevOwner: userID,
									newOwner: sorted.userID,
									guild: currentAlbum.guildName,
									artist: currentAlbum.artistName,
									album: currentAlbum.albumName
								});
							}
						}
					}

					// Record processing time
					const processingTime = Date.now();
					await Time.create({
						ms: processingTime.toString(),
						isAlbum: 'true',
						isArtist: 'false',
						guildID: currentAlbum.guildID
					});

					// Update album record
					if (hasCrown) {
						const newHolder = await fetchUser.usernameFromId(hasCrown.userID);
						await AlbumRecord.create({
							artistName: currentAlbum.artistName,
							albumName: currentAlbum.albumName,
							guildName: currentAlbum.guildName,
							prevOwner: currentAlbum.crownHolder,
							newOwner: newHolder,
							prevPlays: currentAlbum.crownPlays,
							newPlays: hasCrown.albumPlays
						});
					}

					// Log success
					await logToChannel(
						`${threadPrefix} ✅ Processed\n` +
						`👥 Server: ${currentAlbum.guildName}\n` +
						`👑 Previous Crown: ${currentAlbum.crownHolder || 'None'} (${currentAlbum.crownPlays || '0'} plays)\n` +
						`📊 Remaining in queue: ${(await AlbumQueue.findAll()).length}`
					);
				} catch (error) {
					await logError(error, `processing ${currentAlbum.artistName} - ${currentAlbum.albumName}`);
					throw error; // Re-throw to let queue processor handle retry
				}
			}

			// Start the queue processor with error logging
			processQueue({
				queueModel: AlbumQueue,
				processItem: processAlbum,
				logToChannel: async (msg) => {
					try {
						await message.channel.send(msg);
					} catch (err) {
						await logError(err, 'sending queue message');
					}
				},
				itemType: 'album',
				client
			}).catch(async err => {
				await logError(err, 'queue processor crash');
				await message.channel.send(`💥 Queue processor crashed. Check error logs for details. Restarting in 1 minute...`);
				await sleep(60000);
				processQueue({
					queueModel: AlbumQueue,
					processItem: processAlbum,
					logToChannel,
					itemType: 'album',
					client
				});
			});
		}
	} catch (e) {
		await logError(e, 'initialization');
		return;
	}
};

exports.help = {
	name: `albq`,
	description: `**ALB**UM **Q**UEUE: check the album queue`,
	usage: `only the bot owner can run the queue and use a live queue`
};