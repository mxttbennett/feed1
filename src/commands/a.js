const { MessageEmbed } = require(`discord.js`);
const { fetchuser } = require(`../utils/fetchuser`);
const { fetchtrack } = require(`../utils/fetchtrack`);
const { Op } = require(`sequelize`);
const Library = require(`../lib/index.js`);
const ReactionInterface = require(`../utils/ReactionInterface`);

const sortingFunc = (a, b) => {
	const playsDiff = parseInt(b.plays) - parseInt(a.plays);
	return playsDiff === 0 ? a.name.localeCompare(b.name) : playsDiff;
};

const getRandomEmoji = () => {
	const emojis = "🍓 🍎 🍉 🥝 🍍 🫐 🍌 🌽 🥭 🍈 🍕 🥕 🥓 🥫 🍜 🍨 🍭 🥨 🍰 ☕ 🍵 🍸 🍹 🧃 🍩 🌮 🍾 🧇 🍻 😎 🥰 🥵 🤯 😳 😏 😇 😱 🥸 💀 👻 👽 😈 🎭 🎹 🥁 🪘 🎷 🎺 🎸 🪕 🎻 🪗 🛰️ 🪃 🪀 🏓 🛹 🚀 🛸 ⚓ ⛵ 🏖️ 🏝️ 🏜️ 🌋 🌅 🌄 🌌 🐶 🐱 🦊 🐸 🐧 🐦 🐣 🦆 🦉 🦇 🐛 🦋 🐌 🐞 🐢 🦎 🦕 🐙 🦀 🐠 🦧 🐘 🦚 🦜 🦢 🐳 🦒 🦦 🦥 🦔 🌵 🍀 🍄 🪴 🌸 🐚 🌛 🌎 🪐 💫 ✨ 🌈 🌷 🌻 💿 📡 💎 ⚖️ 🧱 🧲 🔫 🧨 ⚰️ 🏺 🔮 🔭 💊 🧬 🦠 🎈 🎵 🍑 🧻 💯 ♻️ 👀 🤠 🤩 🗿 🥶 👹 👏 👑 💼 🧶 🎡 🌃 🥡 🪁 🏆 🚨 🚁 💸 💵 🧯 🕯️ 💉 🖍️ ⁉️ 🃏 🎴 🛡️ 💰 ⛩️ 🕵️ 🥷 🧙 🧙‍♀️ 🧙‍♂️ 🍒 🥩 💩 🎨 ✈️ 🪅 ❤️ 💙 💜 🚩".split(" ");
	return emojis[Math.floor(Math.random() * emojis.length)];
};

const getRandomInt = (min, max) => {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
};

async function getArtistAndAlbum(fetchUser, fetchTrack, lib, args) {
	const user = await fetchUser.username();
	if (!args[0]) {
		if (!user) {
			throw new Error('No Last.fm account registered');
		}
		const track = await fetchTrack.getcurrenttrack();
		if (!track['@attr']) {
			const data = await lib.user.getRecentTracks(user);
			const lastTrack = data.recenttracks.track[0];
			return [lastTrack.artist['#text'], lastTrack.album['#text']];
		}
		return [track.artist['#text'], track.album['#text']];
	}
	const parts = args.join(' ').split(' | ');
	return [parts[0], parts[1]];
}

async function getAlbumInfo(artist, album, lib, message, client) {
	try {
		console.log('\nLast.fm API Request Details:', {
			method: 'album.getInfo',
			artist: artist,
			album: album,
			apiKey: client.config.lastFM.apikey,
			url: `http://ws.audioscrobbler.com/2.0/?method=album.getInfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${client.config.lastFM.apikey}&format=json`
		});

		for (let tries = 0; tries < 3; tries++) {
			try {
				const fetchUser = new fetchuser(client, message);
				const username = await fetchUser.username();
				const data = await lib.album.getInfo(artist, album, username);

				console.log('Last.fm API Success:', {
					status: 'success',
					artistName: data.album.artist,
					albumName: data.album.name,
					attempt: tries + 1
				});
				return data;
			} catch (retryError) {
				console.log(`Attempt ${tries + 1} failed:`, retryError.message);
				if (tries < 2) await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		throw new Error('All retry attempts failed');
	} catch (e) {
		console.error('Last.fm API Error:', {
			status: 'error',
			artist: artist,
			album: album,
			errorMessage: e.message,
			fullError: e
		});

		const embed = new MessageEmbed()
			.setColor(message.member.displayColor)
			.setAuthor(`${artist} — ${album}`, 'https://i.imgur.com/AyfxHoW.gif')
			.setTitle('API Error')
			.setDescription(`There was an error accessing Last.fm's API.\nThis might be due to rate limiting or API issues.\n\nPlease try again in a few moments.`)
			.setFooter(`invoked by ${message.author.username}`, message.author.displayAvatarURL());

		msg = await message.channel.send({ embed });
		return null;
	}
}

exports.run = async (client, message, args) => {
	try {
		const fetchUser = new fetchuser(client, message);
		const fetchTrack = new fetchtrack(client, message);
		const lib = new Library(client.config.lastFM.apikey);
		let msg = null;
		let know = [];

		// Import models
		const [Users, ACrowns, Albums, Time, Notifs, WNotifs] = ['Users', 'ACrowns', 'Albums', 'Time', 'Notifs', 'WNotifs'].map(
			model => client.sequelize.import(`../models/${model}.js`)
		);

		// Get average time from previous checks
		const times = await Time.findAll({
			where: {
				guildID: message.guild.id,
				isAlbum: 'true'
			}
		});

		let time_avg = 0;
		if (times.length > 0) {
			console.log('\nTime calculation debug:');
			console.log('Raw times from database:', times.map(t => t.ms));
			// Convert each time from milliseconds to seconds before averaging
			const time_sum = times.reduce((sum, t) => sum + parseInt(t.ms), 0);
			console.log('Sum of all times (ms):', time_sum);
			console.log('Number of times:', times.length);
			time_avg = (time_sum / times.length) / 1000; // Convert the final average to seconds
			console.log('Calculated average (seconds):', time_avg);
			time_avg = time_avg.toFixed(2);
			console.log('Final formatted average:', time_avg);
		}

		// Get artist and album names
		let [artistName, albumName] = await getArtistAndAlbum(fetchUser, fetchTrack, lib, args);
		
		// Create initial loading embed
		let loadingTitle = `L O A D I N G. . .`;
		if (args.length === 0 && !await fetchUser.username()) {
			loadingTitle += `\nNOTE: cannot fetch currently playing track. the last album scrobbled is being used.`;
		}

		const initialEmbed = new MessageEmbed()
			.setColor(message.member.displayColor)
			.setAuthor(artistName, `https://i.imgur.com/tOuSBYf.gif`)
			.setTitle(loadingTitle)
			.setDescription(message.guild.name + `'s avg album crown check time: \`` + time_avg + ` seconds\``)
			.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
		msg = await message.channel.send({ embed: initialEmbed });

		// Start timing this request - MOVED HERE before API calls start
		const time_before = Date.now();

		// Get album info
		const data = await getAlbumInfo(artistName, albumName, lib, message, client);
		if (!data) {
			return;
		}

		const art_data = await lib.artist.getInfo(data.album.artist).catch(e => {
			console.error('Artist info error:', e);
			return { artist: { url: '' } };
		});

		const hasCrown = await ACrowns.findOne({
			where: {
				guildID: message.guild.id,
				artistName: data.album.artist,
				albumName: data.album.name
			}
		});

		var origKing = ``;
		var origKingPlays = ``;
		var origKingUser = ``;
		if (hasCrown != null) {
			origKing = hasCrown.userID;
		}

		// Get guild members and setup progress tracking
		var id_array = [];
		var member_array = [];
		var guild = await message.guild.members.fetch().then(function (data) {
			for (const [id, member] of data) {
				id_array.push(id);
				member_array.push(member);
			}
		});

		var i = 0;
		for (const id of id_array) {
			const use = await fetchUser.usernameFromId(id);
			if (use) {
				i++;
			}
		}

		if (i >= 3) {
			await msg.react(`1️⃣`);
		}

		var count = 0;
		var counter = 0;
		var total = 0;
		var listeners = 0;

		for (var mem = 0; mem < member_array.length; mem++) {
			var id = member_array[mem].id;
			var member = member_array[mem];
			const user = await fetchUser.usernameFromId(id);
			if (!user) continue;
			
			count++;
			if ((i >= 3) && (count % Math.floor(i / 3) == 0)) {
				counter++;
				if (counter + 1 == 2) await msg.react(`2️⃣`);
				if (counter + 1 == 3) await msg.react(`3️⃣`);
			}

			var req = await lib.album.getInfo(artistName, albumName, user);

			if (id == origKing) {
				if (req.album.userplaycount) {
					origKingPlays = req.album.userplaycount;
					origKingUser = user;
				} else {
					origKingPlays = `0`;
					origKingUser = user;
					continue;
				}
			}

			if (!req.album.userplaycount) continue;

			total += parseInt(req.album.userplaycount);
			if (parseInt(req.album.userplaycount) > 0) {
				listeners++;
			}

			const data = {
				name: member.user.username,
				userID: member.user.id,
				plays: req.album.userplaycount
			};
			know.push(data);
		}

		// Add random emoji at the end
		if (i >= 3) {
			try {
				await msg.react(getRandomEmoji());
			} catch (e) {
				console.error(e);
			}
		}

		// Add this BEFORE the if (!know) check
		var time_after = Date.now();
		var time_diff = time_after - time_before;
		time_diff = (time_diff / 1000).toFixed(2);

		// Now we can use time_diff in our embed
		if (!know || know.length === 0) {
			const embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(data.album.artist, 'https://i.imgur.com/tOuSBYf.gif')
				.setTitle(`No one in the server listens to \`${data.album.name}\`.`)
				.setDescription(message.guild.name + `'s avg album crown check time: \`${time_avg} seconds\`\nthis time took: \`${time_diff} seconds\``)
				.setFooter(`invoked by ${message.author.username}`, message.author.displayAvatarURL());
			
			var edit = await msg.edit({ embed });
			return edit;
		}

		// Now do your sorting
		const sorted = know.sort(sortingFunc)[0];
		
		// Add null check for sorted
		if (!sorted) {
			console.error('No valid sorted data found');
			throw new Error('No valid data found for sorting');
		}

		var cc = 0;
		const emoji_list = "🍓 🍎 🍉 🥝 🍍 🫐 🍌 🌽 🥭 🍈 🍕 🥕 🥓 🥫 🍜 🍨 🍭 🥨 🍰 ☕ 🍵 🍸 🍹 🧃 🍩 🌮 🍾 🧇 🍻 😎 🥰 🥵 🤯 😳 😏 😇 😱 🥸 💀 👻 👽 😈 🎭 🎹 🥁 🪘 🎷 🎺 🎸 🪕 🎻 🪗 🛰️ 🪃 🪀 🏓 🛹 🚀 🛸 ⚓ ⛵ 🏖️ 🏝️ 🏜️ 🌋 🌅 🌄 🌌 🐶 🐱 🦊 🐸 🐧 🐦 🐣 🦆 🦉 🦇 🐛 🦋 🐌 🐞 🐢 🦎 🦕 🐙 🦀 🐠 🦧 🐘 🦚 🦜 🦢 🐳 🦒 🦦 🦥 🦔 🌵 🍀 🍄 🪴 🌸 🐚 🌛 🌎 🪐 💫 ✨ 🌈 🌷 🌻 💿 📡 💎 ⚖️ 🧱 🧲 🔫 🧨 ⚰️ 🏺 🔮 🔭 💊 🧬 🦠 🎈 🎵 🍑 🧻 💯 ♻️ 👀 🤠 🤩 🗿 🥶 👹 👏 👑 💼 🧶 🎡 🌃 🥡 🪁 🏆 🚨 🚁 💸 💵 🧯 🕯️ 💉 🖍️ ⁉️ 🃏 🎴 🛡️ 💰 ⛩️ 🕵️ 🥷 🧙 🧙‍♀️ 🧙‍♂️ 🍒 🥩 💩 🎨 ✈️ 🪅 ❤️ 💙 💜 🚩".split(" ");
		const rand_num = getRandomInt(0, emoji_list.length - 1);
		if (i >= 3) {
			try {
				await msg.react(emoji_list[rand_num]);
			}
			catch (e) {
				console.error(e);
			}
		}

		if (hasCrown === null && sorted && sorted.plays > `0`) {
			await ACrowns.create({
				guildID: message.guild.id,
				userID: sorted.userID,
				albumName: data.album.name,
				artistName: data.album.artist,
				albumPlays: sorted.plays,
				serverPlays: total,
				serverListeners: listeners,
				albumURL: data.album.url
			});
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
				albumURL: data.album.url
			},
				{
					where: {
						guildID: message.guild.id,
						albumName: data.album.name,
						artistName: data.album.artist
					}
				});
			var plays = hasCrown.albumPlays;
			if (!id_array.includes(origKing)) {
				try {
					await ACrowns.update({
						userID: sorted.userID,
						albumPlays: sorted.plays
					},
						{
							where: {
								guildID: message.guild.id,
								albumName: data.album.name,
								artistName: data.album.artist
							}
						});
					const notifiable = await Notifs.findOne({
						where: {
							userID: userID
						}
					});
					if (notifiable && isUser) client.emit(`crownTaken`, {
						prevOwner: userID,
						newOwner: sorted.userID,
						guild: message.guild.name,
						artist: data.album.artist,
						album: data.album.name
					});
					const notifiableW = await WNotifs.findOne({
						where: {
							userID: sorted.userID
						}
					});
					if (notifiableW && isUser) client.emit(`crownWon`, {
						prevOwner: userID,
						newOwner: sorted.userID,
						guild: message.guild.name,
						artist: data.album.artist,
						album: data.album.name
					});
				}
				catch (e) {
					console.log(e);
				}
			}
			if (parseInt(sorted.plays) > parseInt(plays) || (parseInt(origKingPlays) != parseInt(plays) && parseInt(sorted.plays) > 0)) {
				try {
					var kingPlays = -1;
					for (var tries = 0; tries < 10; tries++) {
						var orig = await lib.album.getInfo(artistName, albumName, origKingUser);
						if (parseInt(orig.album.userplaycount) > 1 || orig.album.userplaycount == `0`) {
							kingPlays = parseInt(orig.album.userplaycount);
							break;
						}
					}
					//console.log(kingPlays);
					if (kingPlays >= parseInt(sorted.plays)) {
						sorted.plays = kingPlays;
						sorted.userID = origKing;
					}
					if (kingPlays >= 0) {
						await ACrowns.update({
							userID: sorted.userID,
							albumPlays: sorted.plays
						},
							{
								where: {
									guildID: message.guild.id,
									albumName: data.album.name,
									artistName: data.album.artist
								}
							});
						const notifiable = await Notifs.findOne({
							where: {
								userID: userID
							}
						});
						if (notifiable && isUser) client.emit(`crownTaken`, {
							prevOwner: userID,
							newOwner: sorted.userID,
							guild: message.guild.name,
							artist: data.album.artist,
							album: data.album.name
						});
						const notifiableW = await WNotifs.findOne({
							where: {
								userID: sorted.userID
							}
						});
						if (notifiableW && isUser) client.emit(`crownWon`, {
							prevOwner: userID,
							newOwner: sorted.userID,
							guild: message.guild.name,
							artist: data.album.artist,
							album: data.album.name
						});
					}
				}
				catch (e) {
					console.log(e);
				}
			}
		}

		// Store just the crown check duration
		try {
			await Time.create({
				ms: time_after - time_before,  // This is now just the crown check duration
				isAlbum: 'true',
				isArtist: 'false',
				guildID: message.guild.id
			});
		} catch (e) {
			console.error('Error saving timing:', e);
		}

		if (know.length === 0 || know.every(k => k.plays === '0')) {
			const embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(artistName, 'https://i.imgur.com/tOuSBYf.gif')
				.setTitle(`No one in the server has listened to this album`)
				.setDescription(`${artistName} — ${albumName}`)
				.setFooter(`invoked by ${message.author.username}`, message.author.displayAvatarURL());
			
			if (msg) await msg.edit({ embeds: [embed] });
			else await message.channel.send({ embeds: [embed] });
			return;
		}

		if (i >= 3) {
			// await msg.reactions.removeAll();
		}
		know.sort(sortingFunc);
		let x = 0;
		var sortList = know.sort(sortingFunc);
		const description = sortList
			.slice(0, 10)
			.filter(k => k.plays !== `0`)
			.map(k => (parseInt(k.plays) != 1) ? 
				`${++x}. ${k.name} → **${k.plays}** scrobbles (${parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2))}%)` : 
				`${++x}. ${k.name} → **${k.plays}** scrobble (${parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2))}%)`
			)
			.join(`\n`);
		embed = new MessageEmbed()
			.setColor(message.member.displayColor)
			.setAuthor(data.album.artist, `https://i.imgur.com/bCeKwDd.gif`, art_data.artist.url)
			.setTitle(`*${data.album.name}*`)
			.setURL(data.album.url)
			.setThumbnail(data.album.image[2][`#text`])
			.setDescription(description)
			.setFooter(
				listeners !== 1
					? `${total} scrobbles | ${listeners} listeners | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`
					: total !== 1
						? `${total} scrobbles | ${listeners} listener | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`
						: `${total} scrobble | ${listeners} listener | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`,
				message.author.displayAvatarURL()
			)
		//.setTimestamp();
		await msg.edit({ embed });
		//message.channel.stopTyping();
		if (know.filter(k => k.plays !== `0`).length > 10) {
			await msg.reactions.removeAll();
			const rl = new ReactionInterface(msg, message.author);
			const length = Math.ceil(know.filter(k => k.plays !== `0`).length / 10);
			let offset = 0, page = 1;
			const func = async off => {
				let num = off;
				const description = sortList
					.slice(off, off + 10)
					.filter(k => k.plays !== `0`)
					.map(k => (parseInt(k.plays) != 1) ? 
						`${++num}. ${k.name} → **${k.plays}** scrobbles (${parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2))}%)` : 
						`${++num}. ${k.name} → **${k.plays}** scrobble (${parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2))}%)`
					)
					.join(`\n`);
				const embed = new MessageEmbed()
					.setColor(message.member.displayColor)
					.setAuthor(data.album.artist, `https://i.imgur.com/bCeKwDd.gif`, art_data.artist.url)
					.setTitle(`*${data.album.name}*`)
					.setURL(data.album.url)
					.setThumbnail(data.album.image[2][`#text`])
					.setDescription(description)
					.setFooter(
						listeners !== 1
							? `${total} scrobbles | ${listeners} listeners | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`
							: total !== 1
								? `${total} scrobbles | ${listeners} listener | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`
								: `${total} scrobble | ${listeners} listener | ${((total / listeners).toFixed(2))} avg\nthis crown check took ${time_diff} seconds`,
						message.author.displayAvatarURL()
					)
				await msg.edit({ embed });
			};
			await func(offset);
		}
	} catch (error) {
		console.error('Error in a command:', error);
		throw error; // Still throw the error for other unexpected cases
	}
};