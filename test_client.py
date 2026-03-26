import requests
from dotenv import load_dotenv
import os
from pathlib import Path

# Load .env from Server/.env relative to this script
env_path = Path(__file__).parent / "server" / ".env"
load_dotenv(dotenv_path=env_path)

SERVER_URL = os.getenv("SERVER_URL")

if not SERVER_URL:
    raise ValueError("SERVER_URL not found in server/.env")

video_url = input("Enter YouTube video URL: ").strip()
user_instructions = input("Enter custom instructions: ").strip()

payload = {
    "url": video_url,
    "instructions": user_instructions,
}

response = requests.post(f"{SERVER_URL}/classify", json=payload)

print("\n--- RAW RESPONSE ---")
print(f"Status Code: {response.status_code}")
print(f"Headers: {dict(response.headers)}")
print(f"Body: {response.text}")
print(f"Data Type of body: {type(response.text)}")
print(response.text)