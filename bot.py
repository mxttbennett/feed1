import os
from dotenv import load_dotenv

import discord
from discord.ext import commands

import bot_commands

load_dotenv()

# Define intents
intents = discord.Intents.default()

# Create an instance of the bot with the defined intents
bot = commands.Bot(command_prefix='!', intents=intents)

# List of command details
command_details = [
    {'name': 'nowplaying', 'description': 'Shows what you are currently playing', 'func': bot_commands.now_playing_cmd},
    {'name': 'topartists', 'description': 'Shows your top artists', 'func': bot_commands.top_artists_cmd},
    {'name': 'recenttracks', 'description': 'Displays your most recently played tracks', 'func': bot_commands.recent_tracks_cmd},
    {'name': 'lovedtracks', 'description': 'Lists your loved tracks', 'func': bot_commands.loved_tracks_cmd},
    {'name': 'toptracks', 'description': 'Shows your top tracks', 'func': bot_commands.top_tracks_cmd},
    {'name': 'topalbums', 'description': 'Displays your top albums', 'func': bot_commands.top_albums_cmd},
    {'name': 'artisttoptracks', 'description': 'Shows the top tracks of a specified artist', 'func': bot_commands.artist_top_tracks_cmd},
    {'name': 'artisttopalbums', 'description': 'Lists the top albums of a specified artist', 'func': bot_commands.artist_top_albums_cmd},
    {'name': 'albuminfo', 'description': 'Provides information about a specific album', 'func': bot_commands.album_info_cmd},
    {'name': 'trackinfo', 'description': 'Gives details about a specific track', 'func': bot_commands.track_info_cmd},
    {'name': 'artistinfo', 'description': 'Shows information about a specified artist', 'func': bot_commands.artist_info_cmd},
    {'name': 'userinfo', 'description': 'Displays information about a Last.fm user', 'func': bot_commands.user_info_cmd},
    {'name': 'userfriends', 'description': 'Lists friends of a Last.fm user', 'func': bot_commands.user_friends_cmd},
    {'name': 'usertoptags', 'description': 'Shows the top tags of a Last.fm user', 'func': bot_commands.user_top_tags_cmd},
    {'name': 'artisttags', 'description': 'Displays the top tags for a specified artist', 'func': bot_commands.artist_tags_cmd},
]

async def register_commands():
    for command in command_details:
        bot.tree.command(name=command['name'], description=command['description'])(command['func'])
    await bot.tree.sync()

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}')
    await register_commands()  # Dynamically registers all commands

# Use the Discord bot token from the .env file
bot.run(os.getenv('DISCORD_BOT_TOKEN'))
