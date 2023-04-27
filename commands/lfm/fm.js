const { SlashCommandBuilder } = require('discord.js');
var LastFmNode = require('lastfm').LastFmNode;

const { lastfmKey, lastfmSecret, users } = require.main.require('./config.json')


module.exports = {
    data: new SlashCommandBuilder()
        .setName('fm')
        .setDescription('Posts the user\'s now playing track'),
    async execute(interaction) {
        try {
            var lastfm = new LastFmNode({
                api_key: lastfmKey,
                secret: lastfmSecret,
            });

            await interaction.reply('Now logging now playing scrobbles for user group:');

            users.forEach((user) => {
                var trackStream = lastfm.stream(user);

                trackStream.on('nowPlaying', async (track) => {
                    await interaction.channel.send(`${user} now playing: ${track.name}`);
                });

                trackStream.start();
            })
        }
        catch (e) {
            console.log(e.message)
        }
    },
};