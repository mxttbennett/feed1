
from lastfm import (get_now_playing, get_top_artists, get_recent_tracks, get_loved_tracks, 
                    get_top_tracks, get_top_albums, get_artist_top_tracks, get_artist_top_albums, 
                    get_album_info, get_track_info, get_artist_info, get_user_info, get_user_friends, 
                    get_user_top_tags, get_artist_tags)

async def now_playing_cmd(ctx, username: str):
    await ctx.send(get_now_playing(username))

async def top_artists_cmd(ctx, username: str, limit: int = 5):
    await ctx.send(get_top_artists(username, limit))

# Add more command functions here following the same pattern
