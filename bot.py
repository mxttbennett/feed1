
import discord
from discord.ext import commands
import bot_commands  # This imports the commands module we created

bot = bot_commands.Bot(command_prefix='!')

def register_commands(bot):
    bot.command(name='nowplaying')(bot_commands.now_playing_cmd)
    bot.command(name='topartists')(bot_commands.top_artists_cmd)
    # Register additional commands here using the same pattern

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}')
    register_commands(bot)  # This registers all commands when the bot is ready

bot.run('your_discord_token_here')
