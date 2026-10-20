# Garmin Health Dashboard

**English** · [Español](#español)

A personal health dashboard that connects to Garmin Connect and displays your daily metrics in a clean, mobile-first interface. Works with demo data if no credentials are configured.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https%3A%2F%2Fgithub.com%2Fcggmx%2Fgarmin-health-dashboard&env=GARMIN_USERNAME,GARMIN_PASSWORD&envDescription=Garmin%20Connect%20credentials.%20Leave%20empty%20to%20use%20demo%20data.&project-name=garmin-health-dashboard)

> **Auto-updates:** deploying with this button connects your Vercel project directly to this repository. When a new version is released, Vercel redeploys your instance automatically — no action needed on your end.

---

## Screenshots

| Dashboard | Sleep & HRV | Strain & Stress |
|-----------|-------------|-----------------|
| ![Dashboard](docs/screenshots/01-dashboard.jpeg) | ![Sleep & HRV](docs/screenshots/02-cards.jpeg) | ![Strain & Stress](docs/screenshots/03-strain-stress.jpeg) |

| Sleep Detail | Strain Detail |
|--------------|---------------|
| ![Sleep Detail](docs/screenshots/04-sleep-detail.jpeg) | ![Strain Detail](docs/screenshots/05-strain-detail.jpeg) |

---

## What it does

| Screen | Metrics |
|--------|---------|
| **Dashboard** | Recovery score, HRV, Sleep, Body Battery, Strain, Stress, Steps, Calories |
| **Sleep** | Sleep stages (Deep / REM / Light / Awake), SpO₂, overnight HRV, 7-day trend |
| **Strain** | Daily strain (0–21 scale), ACWR load ratio, activities breakdown |
| **Advice** | 3-day training plan from your last 14 days of load + recovery (HRV, RHR, sleep) — optional, needs Anthropic API key |
| **Training** | Fitness & Freshness (fitness / fatigue / form), weekly effort with target range, training log, goals, year-over-year progress, race predictions + Daniels training paces, best efforts & PRs |
| **Activity** | Splits with grade-adjusted pace, pace / HR / elevation charts, HR & pace zones, best efforts with PR badges, AI insight (optional, Anthropic API key) |
| **Trends** | 7 / 14 / 30-day sparklines, PDF export |
| **Profile** | BMI, VO2max estimate, training zones, weight log |

**Key features**
- 🌐 English / Spanish toggle (auto-detects browser language)
- 🤖 Recovery-aware training advice via Claude (optional — requires Anthropic API key)
- 📱 Installable PWA (iOS Safari & Android Chrome)
- 🔔 Body Battery push notifications
- 🎭 Full demo mode — works without Garmin credentials
- 🔒 No database — all personal data stays in your browser (localStorage)

---

## Tech stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Garmin**: `garmin-connect` npm package
- **AI**: Anthropic Claude Sonnet (optional; model configurable via `ANTHROPIC_MODEL`)

---

## Deploy your own

### Option A — One-click (Vercel)

Click the **Deploy with Vercel** button above. You'll be prompted for:

| Variable | Required | Description |
|----------|----------|-------------|
| `GARMIN_USERNAME` | No | Your Garmin Connect email |
| `GARMIN_PASSWORD` | No | Your Garmin Connect password |
| `ANTHROPIC_API_KEY` | No | For training advice (Claude) |

Leave credentials empty to run in demo mode.

**Keeping your instance up to date**

Since your Vercel project points directly to this repository, new releases deploy to your instance automatically. If you deployed before v1.5.0 (i.e. you have your own forked GitHub repo), you can enable auto-sync by activating the included workflow:

1. Open your forked repo on GitHub
2. Go to **Actions** tab → enable workflows if prompted
3. Find **"Sync fork with upstream"** → click **Run workflow**

From that point on, every Monday your fork syncs automatically and Vercel redeploys.

### Option B — Manual deploy

```bash
# 1. Clone
git clone https://github.com/cggmx/garmin-health-dashboard.git
cd garmin-health-dashboard

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials (all optional)

# 4. Run locally
npm run dev
# → http://localhost:3000

# 5. Deploy to Vercel
npx vercel deploy --prod
```

### Option C — Self-host (Node.js)

```bash
npm run build
npm start
# Runs on port 3000 by default
```

---

## Environment variables

```env
# Garmin Connect (optional — uses demo data if not set)
GARMIN_USERNAME=your@email.com
GARMIN_PASSWORD=yourpassword

# Garmin OAuth tokens — use these if your account has MFA/2FA enabled (see below)
GARMIN_OAUTH1={"oauth_token":"...","oauth_token_secret":"..."}
GARMIN_OAUTH2={"access_token":"...","refresh_token":"...","expires_at":...}

# Training advice (optional — the Advice page shows setup instructions if not set)
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-5-5   # optional override
# ANTHROPIC_EFFORT=low                # optional: low | medium | high

# Push notifications (optional — generated with npm run generate-vapid)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:your@email.com
```

Copy `.env.example` for the full template.

### Accounts with MFA / 2-factor authentication enabled

If Garmin sends you a verification code by email when you sign in, you need to generate OAuth tokens once using the included script:

```bash
node scripts/get-garmin-tokens.js
```

The script will:
1. Ask for your Garmin email and password
2. Detect that MFA is required and wait for you to enter the email code
3. Automatically add `GARMIN_OAUTH1` and `GARMIN_OAUTH2` to your Vercel project
4. Redeploy the app

> **Token expiry**: tokens last ~90 days. Re-run the script when they expire. When `GARMIN_OAUTH1` / `GARMIN_OAUTH2` are set, `GARMIN_USERNAME` / `GARMIN_PASSWORD` are still needed for display purposes but not for authentication.

---

## Mobile installation (PWA) · APK / Play Store

**Is there an APK or Play Store version?**
Not at this time. The app is self-hosted by design — your Garmin credentials never leave your own server. A Play Store version would require a central server storing everyone's credentials, which has significant privacy and cost implications incompatible with the open-source, zero-cost nature of this project.

**The good news:** the app is installable as a PWA directly from your browser — no app store needed, full-screen experience, home screen icon, and push notifications included.

| Platform | Steps |
|----------|-------|
| **iPhone / iPad** | Open in Safari → tap Share → "Add to Home Screen" |
| **Android** | Open in Chrome → tap menu (⋮) → "Add to Home Screen" or "Install app" |

---

## Privacy

- Garmin credentials are stored **only in your server environment** (Vercel env vars or `.env.local`)
- Health data is fetched server-side and never persisted
- Profile, weight log, and preferences are stored in **your browser's localStorage only**
- No analytics, no tracking, no third-party data collection

---

## License

MIT © 2025 — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

## Support

This project is free and open-source. If it's useful to you and you'd like to say thanks, you can buy me a coffee ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support%20the%20project-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/cggmx)

---

## Support

This project is free and open-source. If it's useful to you and you'd like to support its development, you can buy me a coffee — completely optional, always appreciated. ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-cggmx-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/cggmx)

**Contact:** [etxt.me/](https://www.etxt.me/)

---

## Acknowledgements

- [garth](https://github.com/matin/garth) by [@matin](https://github.com/matin) — the MFA token script uses Garmin's mobile JSON API, an approach discovered and documented in the garth project.

---

---

# Español

Dashboard personal de salud que se conecta a Garmin Connect y muestra tus métricas diarias en una interfaz móvil limpia. Funciona con datos demo si no hay credenciales configuradas.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https%3A%2F%2Fgithub.com%2Fcggmx%2Fgarmin-health-dashboard&env=GARMIN_USERNAME,GARMIN_PASSWORD&envDescription=Credenciales%20de%20Garmin%20Connect.%20Deja%20vacío%20para%20usar%20datos%20demo.&project-name=garmin-health-dashboard)

> **Actualizaciones automáticas:** al desplegar con este botón, tu proyecto Vercel queda conectado directamente a este repositorio. Cuando se lanza una nueva versión, Vercel redespliega tu instancia automáticamente — sin que tengas que hacer nada.

---

## Capturas de pantalla

| Dashboard | Sueño & HRV | Esfuerzo & Estrés |
|-----------|-------------|-------------------|
| ![Dashboard](docs/screenshots/01-dashboard.jpeg) | ![Sueño & HRV](docs/screenshots/02-cards.jpeg) | ![Esfuerzo & Estrés](docs/screenshots/03-strain-stress.jpeg) |

| Detalle de Sueño | Detalle de Esfuerzo |
|------------------|---------------------|
| ![Detalle de Sueño](docs/screenshots/04-sleep-detail.jpeg) | ![Detalle de Esfuerzo](docs/screenshots/05-strain-detail.jpeg) |

---

## Qué hace

| Pantalla | Métricas |
|----------|----------|
| **Dashboard** | Recuperación, HRV, Sueño, Body Battery, Esfuerzo, Estrés, Pasos, Calorías |
| **Sueño** | Fases del sueño (Profundo / REM / Ligero / Despierto), SpO₂, HRV nocturno, tendencia 7d |
| **Esfuerzo** | Esfuerzo diario (escala 0–21), ratio ACWR, desglose de actividades |
| **Consejos** | Plan de entrenamiento de 3 días a partir de tus últimos 14 días de carga + recuperación (VFC, FC reposo, sueño) — opcional, requiere API key de Anthropic |
| **Entrenamiento** | Forma y frescura (forma física / fatiga / frescura), esfuerzo semanal con rango objetivo, diario de entrenamiento, metas, progreso interanual, predicción de carreras + ritmos de Daniels, mejores esfuerzos y récords |
| **Actividad** | Parciales con ritmo ajustado por pendiente (GAP), gráficas de ritmo / FC / desnivel, zonas de FC y de ritmo, mejores esfuerzos con récords, análisis IA (opcional, API key de Anthropic) |
| **Tendencias** | Sparklines 7 / 14 / 30 días, exportación PDF |
| **Perfil** | IMC, estimación VO2max, zonas de entrenamiento, registro de peso |

**Características principales**
- 🌐 Toggle inglés / español (detecta el idioma del navegador automáticamente)
- 🤖 Consejos de entrenamiento según tu recuperación, con Claude (opcional — requiere API key de Anthropic)
- 📱 PWA instalable (iOS Safari y Android Chrome)
- 🔔 Notificaciones push de Body Battery
- 🎭 Modo demo completo — funciona sin credenciales de Garmin
- 🔒 Sin base de datos — todos los datos personales quedan en tu navegador (localStorage)

---

## Stack técnico

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Estilos**: Tailwind CSS
- **Gráficas**: Recharts
- **Garmin**: paquete npm `garmin-connect`
- **IA**: Anthropic Claude Sonnet (opcional; modelo configurable con `ANTHROPIC_MODEL`)

---

## Despliega tu propia instancia

### Opción A — Un clic (Vercel)

Haz clic en el botón **Deploy with Vercel** de arriba. Se te pedirán:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `GARMIN_USERNAME` | No | Tu correo de Garmin Connect |
| `GARMIN_PASSWORD` | No | Tu contraseña de Garmin Connect |
| `ANTHROPIC_API_KEY` | No | Para los consejos de entrenamiento (Claude) |

Deja las credenciales vacías para ejecutar en modo demo.

**Mantener tu instancia actualizada**

Al usar este botón, tu proyecto Vercel queda conectado directamente a este repositorio y las nuevas versiones se despliegan solas. Si desplegaste antes de v1.5.0 (es decir, tienes tu propio repositorio fork en GitHub), puedes activar la sincronización automática así:

1. Abre tu fork en GitHub
2. Ve a la pestaña **Actions** → activa los workflows si te lo pide
3. Busca **"Sync fork with upstream"** → haz clic en **Run workflow**

A partir de ahí, cada lunes tu fork se sincroniza solo y Vercel redespliega.

### Opción B — Deploy manual

```bash
# 1. Clonar
git clone https://github.com/cggmx/garmin-health-dashboard.git
cd garmin-health-dashboard

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
# Edita .env.local con tus credenciales (todas opcionales)

# 4. Ejecutar localmente
npm run dev
# → http://localhost:3000

# 5. Desplegar en Vercel
npx vercel deploy --prod
```

### Opción C — Self-hosting (Node.js)

```bash
npm run build
npm start
# Corre en el puerto 3000 por defecto
```

---

## Variables de entorno

```env
# Garmin Connect (opcional — usa datos demo si no está configurado)
GARMIN_USERNAME=tu@correo.com
GARMIN_PASSWORD=tucontraseña

# Tokens OAuth de Garmin — úsalos si tu cuenta tiene MFA/2FA activado (ver abajo)
GARMIN_OAUTH1={"oauth_token":"...","oauth_token_secret":"..."}
GARMIN_OAUTH2={"access_token":"...","refresh_token":"...","expires_at":...}

# Consejos de entrenamiento (opcional — la página Consejos muestra instrucciones si no está configurado)
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-5-5   # opcional
# ANTHROPIC_EFFORT=low                # opcional: low | medium | high

# Notificaciones push (opcional — genera con npm run generate-vapid)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:tu@correo.com
```

Copia `.env.example` para la plantilla completa.

### Cuentas con MFA / verificación en dos pasos activada

Si Garmin te envía un código por correo al iniciar sesión, necesitas generar tokens OAuth una sola vez con el script incluido:

```bash
node scripts/get-garmin-tokens.js
```

El script:
1. Pide tu correo y contraseña de Garmin
2. Detecta que se requiere MFA y espera a que ingreses el código del correo
3. Agrega automáticamente `GARMIN_OAUTH1` y `GARMIN_OAUTH2` a tu proyecto de Vercel
4. Redespliega la app

> **Expiración**: los tokens duran ~90 días. Vuelve a ejecutar el script cuando expiren. Con `GARMIN_OAUTH1` / `GARMIN_OAUTH2` configurados, `GARMIN_USERNAME` / `GARMIN_PASSWORD` siguen siendo necesarios para mostrar tu nombre, pero no para autenticarse.

---

## Instalación móvil (PWA) · APK / Play Store

**¿Hay una APK o versión en la Play Store?**
Por el momento no. La app es self-hosted por diseño — tus credenciales de Garmin nunca salen de tu propio servidor. Una versión en la Play Store requeriría un servidor central que almacene las credenciales de todos los usuarios, lo que implica responsabilidades de privacidad y costos incompatibles con la naturaleza open-source y gratuita de este proyecto.

**La buena noticia:** la app se puede instalar como PWA directamente desde el navegador — sin pasar por ninguna tienda, con experiencia en pantalla completa, ícono en el home y notificaciones push incluidas.

| Plataforma | Pasos |
|------------|-------|
| **iPhone / iPad** | Abre en Safari → toca Compartir → "Agregar a pantalla de inicio" |
| **Android** | Abre en Chrome → menú (⋮) → "Agregar a pantalla de inicio" o "Instalar app" |

---

## Privacidad

- Las credenciales de Garmin se almacenan **solo en tu entorno de servidor** (variables de entorno de Vercel o `.env.local`)
- Los datos de salud se obtienen del lado del servidor y nunca se persisten
- El perfil, registro de peso y preferencias se almacenan **solo en el localStorage de tu navegador**
- Sin analíticas, sin rastreo, sin recolección de datos de terceros

---

## Licencia

MIT © 2025 — libre de usar, modificar y distribuir. Ver [LICENSE](LICENSE).

---

## Apoya el proyecto

Esta app es gratuita y de código abierto. Si te es útil y quieres agradecerlo, puedes invitarme un café ☕

[![Invítame un café](https://img.shields.io/badge/Invítame%20un%20café-apoya%20el%20proyecto-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/cggmx)

---

## Apoya el proyecto

Este proyecto es gratuito y de código abierto. Si te resulta útil y quieres apoyar su desarrollo, puedes invitarme un café — completamente opcional, siempre agradecido. ☕

[![Invítame un café](https://img.shields.io/badge/Invítame%20un%20café-cggmx-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/cggmx)

**Contacto:** [etxt.me/](https://www.etxt.me/)

---

## Agradecimientos

- [garth](https://github.com/matin/garth) por [@matin](https://github.com/matin) — el script de tokens MFA usa la API JSON móvil de Garmin, un enfoque descubierto y documentado en el proyecto garth.
