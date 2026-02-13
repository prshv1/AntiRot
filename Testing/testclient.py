import requests
video_url = input("Paste YouTube URL: ")
payload = {"url": video_url}

#change this to your GCP URL once deployed
response = requests.post("https://anti-rot-341863309794.us-central1.run.app/classify", json=payload)

# 4. Print EVERYTHING — no parsing, raw response
print("\n--- RAW RESPONSE ---")
print(f"Status Code: {response.status_code}")
print(f"Headers: {dict(response.headers)}")
print(f"Body: {response.text}")
print(f"Data Type of body: {type(response.text)}")
print (response)
