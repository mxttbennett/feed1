const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { lastfmKey, lastfmSecret, users } = require.main.require('./config.json')
var LastFmNode = require('lastfm').LastFmNode;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('intersect')
        .setDescription('Reports back the specified intersection.')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Artist or album')
                .addChoices({ name: 'artist', value: 'artist' }, { name: 'album', value: 'album' })
        ),
    async execute(interaction) {
        try {
            const cmdOption = interaction.options.getString('cmd');

            if ((cmdOption.trim() !== 'start' && cmdOption.trim().toLowerCase() !== 'stop')) {
                console.log(cmdOption)
                await interaction.reply('Error: must specify a launch option (cmd param).');
            }
            else if (cmdOption.toLowerCase() === 'start') {
                // only start the now playing feed if an instance doesn't already exist
                if (!global.trackStreamInstance) {
                    var lastfm = new LastFmNode({
                        api_key: lastfmKey,
                        secret: lastfmSecret,
                    });

                    await interaction.reply('Now logging now playing scrobbles for user group:');

                    users.forEach((user) => {
                        var trackStream = lastfm.stream(user);

                        trackStream.on('nowPlaying', async (track) => {
                            const exampleEmbed = new EmbedBuilder()
                                .setColor(interaction.member.displayColor)
                                .setTitle(track.name)
                                .setURL('https://discord.js.org/')
                                .setAuthor({ name: interaction.user.username, iconURL: interaction.member.displayAvatarURL(), url: 'https://www.last.fm/user/dankjankem' })
                                .setDescription(track.name)
                                .setThumbnail(track.image[3]['#text'])
                                .setTimestamp()
                                .setFooter({ text: 'Some footer text here', iconURL: 'https://i.imgur.com/AfFp7pu.png' });

                            await interaction.channel.send({ embeds: [exampleEmbed] });
                        });

                        global.trackStreamInstance = trackStream;
                        global.trackStreamInstance.start();
                    })
                }
                else {
                    await interaction.reply('A now playing feed has already been initialized.');
                }
            }
            else {
                // if "stop" option selected, stop the stream and set the global instance to null
                if (global.trackStreamInstance) {
                    global.trackStreamInstance.stop();
                    global.trackStreamInstance = null;
                    await interaction.reply('Closed the now playing feed.');
                }
                else {
                    await interaction.reply('No feed is currently running.');
                }
            }


        }
        catch (e) {
            console.log(e.message)
        }
    },
};