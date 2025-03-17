const { MessageEmbed } = require(`discord.js`);
const { fetchuser } = require(`../utils/fetchuser`);
const { fetchtrack } = require(`../utils/fetchtrack`);
const { Op } = require(`sequelize`);
const Library = require(`../lib/index.js`);
const ReactionInterface = require(`../utils/ReactionInterface`);


const sortingFunc = (a, b) => (parseInt(b.plays) - parseInt(a.plays) == 0) ? a.name.localeCompare(b.name) : parseInt(b.plays) - parseInt(a.plays);

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};

//IDEA: LOADING BAR AS AN EMBED AND THEN EDIT IT TO PUT THE LIST IN

exports.run = async (client, message, args) => {
	var cons_num = 1;
	//console.log(cons_num++);
	const fetchUser = new fetchuser(client, message);
	const fetchTrack = new fetchtrack(client, message);
	const lib = new Library(client.config.lastFM.apikey);
	const orig_art = args.join(` `);
	var msg = null;
	//console.log(cons_num++);
	try {

		const Users = client.sequelize.import(`../models/Users.js`);
		const Time = client.sequelize.import(`../models/Time.js`);
		const Crowns = client.sequelize.import(`../models/Crowns.js`);
		const Artists = client.sequelize.import(`../models/Artists.js`);
		const Notifs = client.sequelize.import(`../models/Notifs.js`);
		const WNotifs = client.sequelize.import(`../models/WNotifs.js`);
		var lastScrobbled = 0;
		let artistName = args.join(` `);
		const user = await fetchUser.username();
		if (!artistName) {
			if (!user) return message.reply(`you haven't registered your Last.fm ` +
				`account, therefore, I can't check what you're listening to. To set ` +
				`your Last.fm nickname, do \`&login <lastfm username>\`.`);
			var track = await fetchTrack.getcurrenttrack();
			//console.log(track);
			if (!track[`@attr`]) {
				const fuser = await fetchUser.getById(message.author.id);
				var data3 = await lib.user.getRecentTracks(user);
				track = data3.recenttracks.track[0];
				artistName = track.artist[`#text`];
				lastScrobbled = 1;
			}
			else artistName = track.artist[`#text`];
		}

		//console.log(cons_num++);
		var time_before = Date.now();
		const know = [];
		var data;
		try {
			data = await lib.artist.getInfo(artistName);
		}
		catch (e) {
			console.error('Last.fm API error:', e);
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(artistName, `https://i.imgur.com/AyfxHoW.gif`)
				.setTitle(`E R R O R. . .`)
				.setDescription(e.message === 'Request failed. Status code: 400'
					? `The artist was not found on Last.fm or the API is rate limiting.`
					: `An unexpected error occurred. Last.fm may be experiencing issues.`)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			msg = await message.channel.send({ embed });
			return msg;
		}

		//message.react(`✅`);
		//message.channel.startTyping();

		var time = await Time.findAll({
			where: {
				guildID: message.guild.id,
				isArtist: `true`
			}

		});

		//console.log(time.length);

		var time_avg = 0;
		if (time.length > 0) {
			var time_sum = 0;
			for (var t = 0; t < time.length; t++) {
				time_sum += parseInt(time[t].ms) / 1000;
			}
			time_avg = (time_sum / time.length).toFixed(2);
		}

		if (lastScrobbled == 0) {
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(data.artist.name, `https://i.imgur.com/tOuSBYf.gif`)
				.setTitle(`L O A D I N G. . .`)
				.setDescription(message.guild.name + `'s avg artist crown check time: \`` + time_avg + ` seconds\``)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			msg = await message.channel.send({ embed });
		}
		else {
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(artistName, `https://i.imgur.com/tOuSBYf.gif`)
				.setTitle(`L O A D I N G. . .\nNOTE: cannot fetch currently playing track. the last artist scrobbled is being used.`)
				.setDescription(message.guild.name + `'s avg artist crown check time: \`` + time_avg + ` seconds\``)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			msg = await message.channel.send({ embed });
		}



		var artistObj = await Artists.findOne({
			where: {
				artistName: data.artist.name
			}
		});

		var thumbnail = null;
		if (artistObj != null && artistObj.fileExtension != null) {
			thumbnail = artistObj.id + artistObj.fileExtension;
		}

		// message.channel.send(thumbnail);
		//const guild =
		var id_array = [];
		var member_array = [];
		var guild = await message.guild.members.fetch().then(function (data) {

			for (const [id, member] of data) {
				id_array.push(id);
				member_array.push(member);
			}

		});
		//console.log(guild);
		////console.log(cons_num++);
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


		const hasCrown = await Crowns.findOne({
			where: {
				guildID: message.guild.id,
				artistName: data.artist.name
			}
		});

		var origKing = ``;
		var origKingPlays = ``;
		var origKingUser = ``;
		if (hasCrown != null) {
			origKing = hasCrown.userID;
		}
		//console.log(cons_num++);
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
				if (counter + 1 == 2) {
					await msg.react(`2️⃣`);
				}
				if (counter + 1 == 3) {
					await msg.react(`3️⃣`);
				}
			}

			var req = await lib.artist.getInfo(artistName, user);

			/*
			for(var tries = 0; tries < 11; tries++){
				 var req1 = await lib.artist.getInfo(artistName, user);
				 if (parseInt(req1.artist.stats.userplaycount) >= 0){
					 req = await lib.artist.getInfo(artistName, user);
					 break;
				  }
				  else if (tries == 10 || req1.artist.name == artistName){
					 req = req1;
					 break;
				  }
		  }
		  */


			if (id == origKing) {
				if (req.artist.stats.userplaycount) {
					origKingPlays = req.artist.stats.userplaycount;
					origKingUser = user;
				}
				else {
					origKingPlays = `0`;
					origKingUser = user;
					continue;
				}
			}

			if (!req.artist.stats.userplaycount) continue;

			total += parseInt(req.artist.stats.userplaycount);
			if (parseInt(req.artist.stats.userplaycount) > 0) {
				listeners += 1;
			}

			const data = {
				name: member.user.username,
				userID: member.user.id,
				plays: req.artist.stats.userplaycount
			};
			know.push(data);
		}

		// Giving a top-ranking listener in the guild his crown, if he still has none.
		const sorted = know.sort(sortingFunc)[0];
		//console.log(sorted);

		/*
		if (i > 4){
			await msg.react(`❗`);
		}
		*/
		emoji_string = "🍓 🍎 🍉 🥝 🍍 🫐 🍌 🌽 🥭 🍈 🍕 🥕 🥓 🥫 🍜 🍨 🍭 🥨 🍰 ☕ 🍵 🍸 🍹 🧃 🍩 🌮 🍾 🧇 🍻 😎 🥰 🥵 🤯 😳 😏 😇 😱 🥸 💀 👻 👽 😈 🎭 🎹 🥁 🪘 🎷 🎺 🎸 🪕 🎻 🪗 🛰️ 🪃 🪀 🏓 🛹 🚀 🛸 ⚓ ⛵ 🏖️ 🏝️ 🏜️ 🌋 🌅 🌄 🌌 🐶 🐱 🦊 🐸 🐧 🐦 🐣 🦆 🦉 🦇 🐛 🦋 🐌 🐞 🐢 🦎 🦕 🐙 🦀 🐠 🦧 🐘 🦚 🦜 🦢 🐳 🦒 🦦 🦥 🦔 🌵 🍀 🍄 🪴 🌸 🐚 🌛 🌎 🪐 💫 ✨ 🌈 🌷 🌻 💿 📡 💎 ⚖️ 🧱 🧲 🔫 🧨 ⚰️ 🏺 🔮 🔭 💊 🧬 🦠 🎈 🎵 🍑 🧻 💯 ♻️ 👀 🤠 🤩 🗿 🥶 👹 👏 👑 💼 🧶 🎡 🌃 🥡 🪁 🏆 🚨 🚁 💸 💵 🧯 🕯️ 💉 🖍️ ⁉️ 🃏 🎴 🛡️ 💰 ⛩️ 🕵️ 🥷 🧙 🧙‍♀️ 🧙‍♂️ 🍒 🥩 💩 🎨 ✈️ 🪅 ❤️ 💙 💜 🚩"
		emoji_list = emoji_string.split(" ");
		rand_num = getRandomInt(0, emoji_list.length - 1);
		if (i >= 3) {
			try {
				await msg.react(emoji_list[rand_num]);
			}
			catch (e) {
				console.error(e);
			}
		}

		if (hasCrown === null) {
			await Crowns.create({
				guildID: message.guild.id,
				userID: sorted.userID,
				artistName: data.artist.name,
				artistPlays: sorted.plays
			});
		} else {
			await Crowns.update({
				userID: sorted.userID,
				artistPlays: sorted.plays
			}, {
				where: {
					guildID: message.guild.id,
					artistName: data.artist.name
				}
			});
		}


		if (hasCrown !== null) {
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
			},
				{
					where: {
						guildID: message.guild.id,
						artistName: data.artist.name
					}
				});
			var plays = hasCrown.artistPlays;
			if (!id_array.includes(origKing)) {
				try {
					await Crowns.update({
						userID: sorted.userID,
						artistPlays: sorted.plays
					},
						{
							where: {
								guildID: message.guild.id,
								artistName: data.artist.name
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
						artist: data.artist.name
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
						artist: data.artist.name
					});
				}
				catch (e) {
					console.error(e);
				}
			}
			else if (parseInt(sorted.plays) > parseInt(plays) || (parseInt(origKingPlays) != parseInt(plays) && parseInt(sorted.plays) > 0)) {
				try {
					var kingPlays = -1;
					for (var tries = 0; tries < 10; tries++) {
						var orig = await lib.artist.getInfo(artistName, origKingUser);
						if (parseInt(orig.artist.stats.userplaycount) > 1 || orig.artist.stats.userplaycount == `0`) {
							kingPlays = parseInt(orig.artist.stats.userplaycount);
							break;
						}
					}
					if (kingPlays >= parseInt(sorted.plays)) {
						sorted.plays = kingPlays;
						sorted.userID = origKing;
					}
					if (kingPlays >= 0) {
						await Crowns.update({
							userID: sorted.userID,
							artistPlays: sorted.plays
						},
							{
								where: {
									guildID: message.guild.id,
									artistName: data.artist.name
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
							artist: data.artist.name
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
							artist: data.artist.name
						});
					}
				}
				catch (e) {
					console.log(e);
				}
			}
		}



		var time_after = Date.now();
		var time_diff = time_after - time_before;

		try {
			const existingTime = await Time.findOne({
				where: {
					guildID: message.guild.id,
					isArtist: 'true'
				}
			});

			if (existingTime) {
				await Time.update({
					ms: time_diff
				}, {
					where: {
						guildID: message.guild.id,
						isArtist: 'true'
					}
				});
			} else {
				await Time.create({
					ms: time_diff,
					isArtist: 'true',
					guildID: message.guild.id
				});
			}
		} catch (e) {
			console.error('Time tracking error:', e);
		}

		time_diff = (time_diff / 1000).toFixed(2);

		if (know.length === 0 || know.every(x => x.plays === `0`)) {
			if (i >= 3) {
				// await msg.reactions.removeAll();
			}
			embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(data.artist.name, `https://i.imgur.com/tOuSBYf.gif`)
				.setTitle(`No one in the server listens to \`` + data.artist.name + `\`.`)
				.setDescription(message.guild.name + `'s avg artist crown check time: \`` + time_avg + ` seconds\`\nthis time took: \`` + time_diff + ` seconds\``)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			var edit = await msg.edit({ embed });
			return edit;
		}

		/*
		if(time_diff > 5){
			embed = new MessageEmbed()
			  .setColor(message.member.displayColor)
			  .setAuthor(data.artist.name, `https://i.imgur.com/tOuSBYf.gif`)
			  .setTitle(`L O A D I N G. . .`)
			  .setDescription(message.guild.name + `'s avg artist crown check time: \`` + time_avg + ` seconds\`\nthis time took: \`` + time_diff + ` seconds\``); 
			await msg.edit({embed});
			await sleep(1500);
		}
		*/

		if (i >= 3) {
			// await msg.reactions.removeAll();
		}
		know.sort(sortingFunc);
		let x = 0;
		var sortList = know.sort(sortingFunc);
		const description = sortList
			.slice(0, 10)
			.filter(k => k.plays !== `0`)
			.map(k => (parseInt(k.plays) != 1) ? `${++x}. ${k.name} → **${k.plays}** scrobbles (` + parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2)) + `%)` : `${++x}. ${k.name} → **${k.plays}** scrobble (` + parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2)) + `%)`)
			.join(`\n`);
		if (thumbnail != null) {
			try {
				const embed = new MessageEmbed()
					.setColor(message.member.displayColor)
					.setTitle(`${data.artist.name}`)
					.setURL(data.artist.url)
					.attachFiles([`${process.env.PWD}/art_imgs/` + thumbnail])
					.setThumbnail(`attachment://` + thumbnail)
					.setDescription(description)
					.setFooter((listeners != 1) ? `${total} scrobbles | ${listeners} listeners | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : (total != 1) ? `${total} scrobbles | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : `${total} scrobble | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds`, message.author.displayAvatarURL())
				await msg.edit({ embed });
			}
			catch (e) {
				console.log(e);
				const embed = new MessageEmbed()
					.setColor(message.member.displayColor)
					.setTitle(`${data.artist.name}`)
					.setURL(data.artist.url)
					.setDescription(description)
					.setFooter((listeners != 1) ? `${total} scrobbles | ${listeners} listeners | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : (total != 1) ? `${total} scrobbles | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : `${total} scrobble | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds`, message.author.displayAvatarURL())
				await msg.edit({ embed });
			}
		}
		else {
			const embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setTitle(`${data.artist.name}`)
				.setURL(data.artist.url)
				.setDescription(description)
				.setFooter((listeners != 1) ? `${total} scrobbles | ${listeners} listeners | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : (total != 1) ? `${total} scrobbles | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds` : `${total} scrobble | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took ` + time_diff + ` seconds`, message.author.displayAvatarURL())
			await msg.edit({ embed });
		}
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
					.map(k => (parseInt(k.plays) != 1) ? `${++num}. ${k.name} → **${k.plays}** scrobbles (` + parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2)) + `%)` : `${++num}. ${k.name} → **${k.plays}** scrobble (` + parseFloat(((parseFloat(k.plays) / parseFloat(total)) * 100).toFixed(2)) + `%)`)
					.join(`\n`);
				const embed = new MessageEmbed()
					.setColor(message.member.displayColor)
					.setTitle(`${data.artist.name}`)
					.setURL(data.artist.url)
					.setDescription(description)
					.setFooter((listeners != 1) ? `${total} scrobbles | ${listeners} listeners | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took: ` + time_diff + ` seconds` : (total != 1) ? `${total} scrobbles | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took: \`` + time_diff + ` seconds\`` : `${total} scrobble | ${listeners} listener | ` + parseFloat((parseFloat(total) / parseFloat(listeners)).toFixed(2)) + ` avg\nthis crown check took: \`` + time_diff + ` seconds\``, message.author.displayAvatarURL())
				await msg.edit({ embed });
			};
			const toFront = () => {
				if (page !== length) {
					offset += 10, page++;
					func(offset);
				}
			};
			const toBack = () => {
				if (page !== 1) {
					offset -= 10, page--;
					func(offset);
				}
			};
			const emptyFunc = () => {
			};
			await rl.setKey(client.snippets.arrowLeft, toBack);
			await rl.setKey(client.snippets.arrowRight, toFront);
			await rl.setKey(emoji_list[rand_num], emptyFunc);
		}
		//message.channel.stopTyping();
	} catch (e) {
		//if (e.name !== `SequelizeUniqueConstraintError`) {
		console.error(e);
		if (msg != null) {
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(`Oh no!`, `https://i.imgur.com/AyfxHoW.gif`)
				.setTitle(`E R R O R. . .`)
				.setDescription(`an unexpected error occurred. Last.fm may be experiencing issues.`)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			var edit = await msg.edit({ embed });
			return edit;
		}
		else {
			var embed = new MessageEmbed()
				.setColor(message.member.displayColor)
				.setAuthor(`Oh no!`, `https://i.imgur.com/AyfxHoW.gif`)
				.setTitle(`E R R O R. . .`)
				.setDescription(`an unexpected error occurred. Last.fm may be experiencing issues.`)
				.setFooter(`invoked by ` + message.author.username, message.author.displayAvatarURL());
			await message.channel.send({ embed });

		}
		//}
	}
};

exports.help = {
	name: `wk`,
	description: `Checks if anyone in a guild listens to a certain artist. If ` +
		`no artist is defined, the bot will try to look up the artist you are ` +
		`currently listening to.`,
	usage: `wk <artist name>`,
	notes: `This feature might be quite slow, because it sends a lot of API ` +
		`requests. Also, it only works in a guild.`
};
