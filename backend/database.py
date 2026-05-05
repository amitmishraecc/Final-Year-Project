import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    raise ValueError("MONGO_URI not found in environment variables")

client = MongoClient(MONGO_URI)

db = client["studentDB"]

users_collection = db["users"]
attendance_collection = db["attendance"]
marks_collection = db["marks"]


