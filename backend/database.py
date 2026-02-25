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



# from pymongo import MongoClient

# MONGO_URI = "mongodb+srv://amitmishrajnp:Amit123@amit1.tpfbfhc.mongodb.net"

# client = MongoClient(MONGO_URI)
# db = client["studentDB"]

# users_collection = db["users"]
