# SpaceStyler room-analysis API (CPU).
# Works locally (docker compose) and on Hugging Face Spaces (Docker SDK, port 7860).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf-cache \
    PORT=7860

# libgl/glib are needed by OpenCV even in headless mode on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# CPU-only PyTorch wheels keep the image ~1.5 GB smaller than the CUDA build.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install -r requirements.txt

# Bake model weights into the image so the first request isn't a 1.4 GB download.
# EoMT-L is the default segmenter; SegFormer-B2 stays cached as the SEG_MODEL fallback.
RUN python -c "from transformers import AutoImageProcessor as P, AutoModelForSemanticSegmentation as S, AutoModelForDepthEstimation as D, EomtForUniversalSegmentation as E; \
[P.from_pretrained(m) for m in ('tue-mps/ade20k_semantic_eomt_large_512','nvidia/segformer-b2-finetuned-ade-512-512','depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf')]; \
E.from_pretrained('tue-mps/ade20k_semantic_eomt_large_512'); S.from_pretrained('nvidia/segformer-b2-finetuned-ade-512-512'); D.from_pretrained('depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf')" \
    && chmod -R a+rX /opt/hf-cache

COPY app ./app
COPY static ./static

# Hugging Face Spaces runs containers as uid 1000.
# backend/var holds the owner-managed catalogue and uploaded rug images. Mount a
# volume there (or set CATALOG_PATH / UPLOAD_DIR) so owner edits survive restarts.
RUN useradd -m -u 1000 appuser && mkdir -p /app/var && chown appuser /app/var
USER appuser
ENV HF_HUB_OFFLINE=1

EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
