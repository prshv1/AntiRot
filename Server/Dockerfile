# Start from a lightweight Python image
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Copy requirements first (Docker caches this layer — if deps don't change, it skips reinstalling)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your actual code
COPY server.py .
COPY .env .

# Tell Docker this container will listen on port 8080
EXPOSE 8080

# The command that runs when the container starts
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]