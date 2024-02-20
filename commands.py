
from discord.ext import commands
from lastfm import (get_now_playing, get_top_artists, get_recent_tracks, get_loved_tracks, 
                    get_top_tracks, get_top_albums, get_artist_top_tracks, get_artist_top_albums, 
                    get_album_info, get_track_info, get_artist_info, get_user_info, 
                    get_user_friends, get_user_top_tags, get_artist_tags)

async def now_playing_cmd(ctx, username: str):
    await ctx.send(get_now_playing(username))

async def top_artists_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_top_artists(username, limit))

async def recent_tracks_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_recent_tracks(username, limit))

async def loved_tracks_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_loved_tracks(username, limit))

async def top_tracks_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_top_tracks(username, limit))

async def top_albums_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_top_albums(username, limit))

async def artist_top_tracks_cmd(ctx, artist_name: str, limit: int = 5):
    await ctx.send(get_artist_top_tracks(artist_name, limit))

async def artist_top_albums_cmd(ctx, artist_name: str, limit: int = 5):
    await ctx.send(get_artist_top_albums(artist_name, limit))

async def album_info_cmd(ctx, artist_name: str, album_name: str):
    await ctx.send(get_album_info(artist_name, album_name))

async def track_info_cmd(ctx, artist_name: str, track_name: str):
    await ctx.send(get_track_info(artist_name, track_name))

async def artist_info_cmd(ctx, artist_name: str):
    await ctx.send(get_artist_info(artist_name))

async def user_info_cmd(ctx, username: str):
    await ctx.send(get_user_info(username))

async def user_friends_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_user_friends(username, limit))

async def user_top_tags_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_user_top_tags(username, limit))

async def artist_tags_cmd(ctx, artist_name: str):
    await ctx.send(get_artist_tags(artist_name))

# Additional commands can be added here following the same pattern
