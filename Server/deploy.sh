gcloud builds submit \
  --tag us-central1-docker.pkg.dev/antirot-490306/antirot-gcp/api-server:latest \
  . && \
gcloud run deploy api-server \
  --image us-central1-docker.pkg.dev/antirot-490306/antirot-gcp/api-server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --project=antirot-490306
