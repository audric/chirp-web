FROM python:3.12-slim

WORKDIR /app

# Install chirp from local source
COPY chirp-src /tmp/chirp-src
RUN pip install --no-cache-dir /tmp/chirp-src && rm -rf /tmp/chirp-src

# Install chirp-web dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ app/

# Create runtime dirs
RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
