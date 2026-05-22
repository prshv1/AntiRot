import requests
from dotenv import load_dotenv
import os
from pathlib import Path

# Load .env from Server/.env relative to this script
env_path = Path(__file__).parent / "Server" / ".env"
load_dotenv(dotenv_path=env_path)

SERVER_URL = os.getenv("SERVER_URL")
INSTALL_ID = os.getenv("INSTALL_ID")
INSTALL_TOKEN = os.getenv("INSTALL_TOKEN")

if not SERVER_URL:
    raise ValueError("SERVER_URL not found in Server/.env")

video_url = input("Enter YouTube video URL: ").strip()
user_instructions = input("Enter custom instructions: ").strip()

if not INSTALL_ID or not INSTALL_TOKEN:
    registration_response = requests.post(
        f"{SERVER_URL}/installs/register",
        json={"client": {"source": "test_client"}},
    )
    registration_response.raise_for_status()
    registration = registration_response.json()
    INSTALL_ID = registration["install_id"]
    INSTALL_TOKEN = registration["install_token"]
    print("\n--- INSTALL REGISTRATION ---")
    print(f"INSTALL_ID={INSTALL_ID}")
    print(f"INSTALL_TOKEN={INSTALL_TOKEN}")

payload = {
    "url": video_url,
    "instructions": user_instructions,
    "install_id": INSTALL_ID,
    "install_token": INSTALL_TOKEN,
}

response = requests.post(f"{SERVER_URL}/classify", json=payload)

print("\n--- RAW RESPONSE ---")
print(f"Status Code: {response.status_code}")
print(f"Headers: {dict(response.headers)}")
print(f"Body: {response.text}")
print(f"Data Type of body: {type(response.text)}")
print(response.text)
