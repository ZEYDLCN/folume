# Folume API on a free Hugging Face Space (Docker). The Space repository holds pyproject.toml, src/ and this file:
# deploy/huggingface/publish.sh puts them together and pushes them.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FOLUME_DATA_DIR=/tmp/folume-jobs \
    FOLUME_SYNC_DB=/tmp/folume-sync.sqlite3

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install .

# Spaces run the container as user 1000 and send traffic to the port named in README.md (app_port)
RUN useradd --create-home --uid 1000 user
USER user
EXPOSE 7860

CMD ["uvicorn", "folume.main:app", "--host", "0.0.0.0", "--port", "7860"]
