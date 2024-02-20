import os
from dotenv import load_dotenv

import pylast

load_dotenv()

API_KEY = os.getenv('LASTFM_API_KEY')
API_SECRET = os.getenv('LASTFM_API_SECRET')

network = pylast.LastFMNetwork(api_key=API_KEY, api_secret=API_SECRET)