const { SlashCommandBuilder } = require('discord.js');
var LastFmNode = require('lastfm').LastFmNode;

const { lastfmKey, lastfmSecret } = require.main.require('./config.json')


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

            const trackStream = lastfm.stream('dankjankem')

            if (trackStream) {
                await interaction.reply('Now logging now playing scrobbles:')
            }

            trackStream.on('nowPlaying', async (track) => {
                console.log(track.name)
                await interaction.channel.send('Now playing:' + track.name)
            });
        }
        catch (e) {
            console.log(e.message)
        }
    },
};