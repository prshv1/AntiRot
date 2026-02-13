import requests
from dotenv import load_dotenv
import os
from supadata import Supadata, SupadataError
import time

#Openrouter Credentials
start = time.perf_counter()
load_dotenv()
url = "https://openrouter.ai/api/v1/chat/completions"
Openrouter_API_KEY = os.getenv("Openrouter_API_KEY")
System_Prompt = os.getenv("System_Prompt")
Supadata_API_KEY=os.getenv("Supadata_API_KEY")
end = time.perf_counter()
print("load_credentials:", end-start)

def Vid_Cat(Vid_Transcript):    
    
    #API Request
    headers = {
        "Authorization": f"Bearer {Openrouter_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": "openai/gpt-oss-120b:free",   # change to any model you want
        "messages": [
        {"role": "system", "content": System_Prompt},
        {"role": "user", "content": Vid_Transcript}
    ]
    }

    #Response parsing & output
    response = requests.post(url, headers=headers, json=data)
    result = response.json()
    
    return(result["choices"][0]["message"]["content"])
    
def Get_Transcript(Vid_URL):

    # Initialize the client
    supadata = Supadata(api_key=Supadata_API_KEY)

    # Get transcript from any supported platform (YouTube, TikTok, Instagram, X (Twitter), file URLs)
    transcript = supadata.transcript(
        url=Vid_URL,
        text=True,  #return plain text instead of timestamped chunks
        mode="auto"
    )
    
    return(transcript.content)

Vid_URL=input("Enter Video URL:")

#Get Transcript
start = time.perf_counter()
Vid_Transcript=Get_Transcript(Vid_URL)
end = time.perf_counter()
print("\n Supadata API:", end-start)

#Get Category
start = time.perf_counter()
Vid_Category = Vid_Cat(Vid_Transcript)
end = time.perf_counter()
print("\n OpenROUTER API:", end-start)

print (Vid_Category)