# Conversion + AI gateway + optional sync API.  Build from the repository root:  docker build -t folume-api backend
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FOLUME_DATA_DIR=/data/jobs \
    FOLUME_SYNC_DB=/data/sync.sqlite3

# Optional OCR for scanned PDFs: docker build --build-arg WITH_OCR=1 ..., then run with -e FOLUME_OCR=1.
# The engine pulls in OpenCV with a GUI dependency (libGL) that the slim image lacks: its headless build replaces it.
ARG WITH_OCR=0

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN if [ "$WITH_OCR" = "1" ]; then \
      pip install ".[ocr]" && pip uninstall -y opencv-python && pip install opencv-python-headless; \
    else \
      pip install .; \
    fi

# conversions run as an unprivileged user; /data holds the temporary job directories and the optional sync database
RUN useradd --create-home --uid 10001 folume && mkdir -p /data && chown folume /data
USER folume
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "folume.main:app", "--host", "0.0.0.0", "--port", "8000"]
