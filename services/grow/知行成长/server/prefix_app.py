import os
from app import app as application
from web_prefix import PrefixApp

app = PrefixApp(application, os.getenv('GROW_BASE_PATH', ''))
