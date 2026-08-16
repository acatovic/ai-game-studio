

# AI Game Studio

Una aplicación web local — y el inicio de un AI Game Studio más completo — para generar activos de juegos a partir de prompts de texto. Por ahora: sprites de referencia 2D y fotogramas de animación compuestos en una spritesheet de 1×N con una vista previa animada en bucle. Los fondos se recortan automáticamente a transparencia mediante chroma-key, por lo que los fotogramas pueden insertarse directamente en un motor de juego. Los proyectos se pueden guardar y cargar por nombre.

La aplicación se comunica con [OpenRouter](https://openrouter.ai) como único punto de enlace a los proveedores de modelos. Una sola clave da acceso a más de 300 modelos de imagen, video, audio y texto, lo que sienta las bases para todo lo que hay en la lista de TO-DO (fondos, tilemaps, SFX, música, voz, …).

Elige el modelo de video en el momento de la generación: actualmente **Grok Imagine Video** (xAI) o **Seedance 2.0** (ByteDance), ambos enrutados a través de OpenRouter.

![Mockup](mockup.png)

Demo completo: https://www.youtube.com/watch?v=MijheSPXnDo

## Requisitos

- Node 20+
- `ffmpeg` en el `PATH`
- Una [clave API de OpenRouter](https://openrouter.ai/keys)

## Instalación

```bash
npm install

cp .env.example .env
# then open .env and paste your key:
# OPENROUTER_API_KEY=sk-or-v1-...
```

## Ejecución

```bash
npm run dev
```

Abre http://localhost:5173.

Esto inicia Vite (frontend, :5173) y un servidor Express (backend, :8787) simultáneamente. Deténlo con `Ctrl+C`.

## Cómo usarlo

1. Escribe un prompt de sprite en la columna 1 → **Generate Reference Sprite**.
2. Selecciona un modelo de video y escribe un prompt de movimiento en la columna 2 → **Generate Frames** (realiza la llamada de imagen-a-video a través de OpenRouter, consulta el estado hasta que finalice y extrae PNGs transparentes).
3. Haz clic en los cuadros de los fotogramas para activar o desactivar cuáles incluir.
4. **Generate Spritesheet** → compone un PNG de 1×N en el cliente y genera una vista previa GIF en bucle en el servidor.
5. **Export PNG** para descargar la spritesheet.
6. Encabezado: **New** para empezar desde cero, **Save** para nombrar y guardar una instantánea del proyecto actual, **Load** para cambiar a uno guardado.

Los artefactos generados se almacenan en `projects/` (ignorado por git). El estado de trabajo actual siempre estará en `projects/latest/`.

## Prompts de ejemplo

### Prompts de sprite

- `A pixel-art knight in silver armor with a longsword, side-view, full body, simple flat colors, standing pose`
- `Female ninja with red scarf, dynamic side-view, 2D sprite, anime style`
- `Cute green slime monster, side-view, big eyes, soft shading`
- `Cyberpunk hacker in a hoodie, glowing visor, side-view full body, gritty style`

### Prompts de movimiento

- `Smooth walk cycle, side-view, no head tilting, no camera movement`
- `Sword slash attack, side-view, fast, no shadows`
- `Idle breathing animation, subtle, looping`
- `Jump arc — crouch, leap, mid-air, land`

Consejos:
- Mantén los prompts de movimiento enfocados en la acción. Frases como *"no camera movement"*, *"side-view"* y *"no head tilting"* ayudan a mantener los fotogramas listos para el juego.
- Duraciones predeterminadas por modelo: Grok Imagine Video = 2 s, Seedance 2.0 = 4 s. ~24–30 fps en el clip original, así que recorta con el selector de fotogramas antes de componer.
- Cambiar el modelo requiere modificar una entrada en `server/video.ts` — consulta `VIDEO_MODELS`.
- Recomienda quedarte con Grok Imagine Video ya que es mucho más barato que Seedance 2

## TO-DO

- [ ] Generación de fondos
- [ ] Generación de tilemaps
- [ ] Exportación a formato Aseprite
- [ ] Exportación a formato Tiled
- [ ] Generación de SFX
- [ ] Generación de música
- [ ] Generación de voz
- [ ] Exportación de estructura completa de activos

## Más información

Consulta [AGENTS.md](AGENTS.md) para la especificación completa, arquitectura, lista de endpoints, patrón de registro de modelos y notas de ajuste de chroma-key.
