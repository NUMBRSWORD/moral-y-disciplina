"""Lee una página en memoria y devuelve líneas con coordenadas sobre la imagen enviada."""
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps


def corregir_iluminacion(imagen):
    """Compensa sombras amplias sin cambiar las coordenadas de la página."""
    alto, ancho = imagen.shape
    escala = min(1, 750 / max(alto, ancho))
    muestra = cv2.resize(imagen, (max(1, round(ancho * escala)), max(1, round(alto * escala))),
                         interpolation=cv2.INTER_AREA)
    lado = max(9, round(min(muestra.shape) * 0.045) | 1)
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (lado, lado))
    fondo = cv2.morphologyEx(muestra, cv2.MORPH_CLOSE, nucleo)
    fondo = cv2.GaussianBlur(fondo, (0, 0), lado / 4)
    bajo, alto_fondo = np.percentile(fondo, [10, 90])
    oscuro, claro = np.percentile(muestra, [0.5, 98])
    sombra = alto_fondo - bajo >= 24
    tenue = claro - oscuro < 70
    if not sombra and not tenue:
        return imagen

    fondo = cv2.resize(fondo, (ancho, alto), interpolation=cv2.INTER_LINEAR)
    corregida = cv2.divide(imagen, np.maximum(fondo, 1), scale=245)
    if tenue:
        suave = cv2.medianBlur(corregida, 3)
        oscuro, claro = np.percentile(suave, [0.5, 80])
        # En papel en blanco el ruido por sí solo no justifica estirar el contraste.
        if 10 <= claro - oscuro < 72:
            ampliada = (suave.astype(np.float32) - oscuro) * (235 / (claro - oscuro)) + 10
            return np.clip(ampliada, 0, 255).astype("uint8")
    return corregida if sombra else imagen


def alinear(imagen):
    alto, ancho = imagen.shape
    escala = min(1, 800 / max(alto, ancho))
    muestra = cv2.resize(imagen, (max(1, round(ancho * escala)), max(1, round(alto * escala))),
                         interpolation=cv2.INTER_AREA)
    _, tinta = cv2.threshold(muestra, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = tinta.shape

    def puntuacion(grados):
        giro = cv2.getRotationMatrix2D((w / 2, h / 2), grados, 1)
        filas = cv2.warpAffine(tinta, giro, (w, h), flags=cv2.INTER_NEAREST).sum(axis=1, dtype=float)
        return np.square(np.diff(filas)).sum()

    angulo = max(range(-12, 13), key=puntuacion)
    angulo = max((angulo - .5, angulo, angulo + .5), key=puntuacion)
    if puntuacion(angulo) <= 1.12 * puntuacion(0):
        angulo = 0
    giro = cv2.getRotationMatrix2D((ancho / 2, alto / 2), angulo, 1)
    cos, sen = abs(giro[0, 0]), abs(giro[0, 1])
    w = int(np.ceil(ancho * cos + alto * sen))
    h = int(np.ceil(alto * cos + ancho * sen))
    giro[:, 2] += [(w - ancho) / 2, (h - alto) / 2]
    return cv2.warpAffine(imagen, giro, (w, h), borderValue=255), cv2.invertAffineTransform(giro)


def leer(datos):
    with Image.open(io.BytesIO(datos)) as pagina:
        if pagina.width * pagina.height > 12_000_000:
            raise ValueError("Página demasiado grande")
        original = np.asarray(ImageOps.exif_transpose(pagina).convert("L"))
    alineada, inversa = alinear(corregir_iluminacion(original))
    ejecutable = Path(os.environ["ProgramFiles"]) / "Tesseract-OCR" / "tesseract.exe"
    args = [str(ejecutable), "stdin", "stdout", "--tessdata-dir", os.environ.get("FALTOS_TESSDATA", str(ejecutable.parent / "tessdata")),
            "-l", "spa", "-c", "tessedit_create_tsv=1"]
    proceso = subprocess.run(args, input=cv2.imencode(".png", alineada)[1].tobytes(),
                             capture_output=True, check=True, timeout=50)
    lineas = {}
    for palabra in csv.DictReader(io.StringIO(proceso.stdout.decode("utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE):
        if palabra["level"] != "5" or not palabra["text"].strip():
            continue
        clave = tuple(palabra[k] for k in ("block_num", "par_num", "line_num"))
        x, y, w, h = (int(palabra[k]) for k in ("left", "top", "width", "height"))
        palabras, esquinas, dudosos = lineas.setdefault(clave, ([], [], []))
        palabras.append(palabra["text"])
        # El puntaje TSV es una señal para revisar, no una probabilidad de acierto.
        if any(c.isdigit() for c in palabra["text"]) and float(palabra["conf"]) < 70:
            dudosos.append(palabra["text"])
        esquinas.extend([(x, y), (x+w, y), (x, y+h), (x+w, y+h)])
    salida = []
    alto, ancho = original.shape
    for palabras, esquinas, dudosos in lineas.values():
        puntos = cv2.transform(np.array([esquinas], dtype=float), inversa)[0] / [ancho, alto]
        caja = np.clip([*puntos.min(axis=0), *puntos.max(axis=0)], 0, 1)
        salida.append({"texto": " ".join(palabras), "caja": caja.round(5).tolist(),
                       "numerosDudosos": dudosos})
    return salida


if __name__ == "__main__":
    print(json.dumps(leer(sys.stdin.buffer.read()), ensure_ascii=True))
