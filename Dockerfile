FROM python:3.12-slim

WORKDIR /app

# Install chirp from GitHub
ARG CHIRP_REPO=https://github.com/kk7ds/chirp.git
ARG CHIRP_BRANCH=master
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && pip install --no-cache-dir "git+${CHIRP_REPO}@${CHIRP_BRANCH}" \
    && apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Install chirp-web dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ app/

# Create runtime dirs
RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
