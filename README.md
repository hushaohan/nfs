# VELOCITY RUSH — NFS-Style Racing Game

A browser-based, Need-for-Speed-style street racing game with a **realistic
slip-based vehicle physics model**, built on Three.js with zero external
assets (all textures, meshes, and audio are generated procedurally).

## Run it

It's a fully static site — no build step, no dependencies, no network
requests. Either:

- **Open `index.html` directly** in a browser (double-click it), or
- serve the folder with any static file server, e.g.:

  ```bash
  python3 -m http.server 8000
  # open http://127.0.0.1:8000/
  ```

## Controls

| Action            | Keys                    |
|-------------------|-------------------------|
| Throttle          | `W` / `↑`               |
| Brake / Reverse   | `S` / `↓`               |
| Steer             | `A` `D` / `←` `→`       |
| Handbrake (drift) | `Space`                 |
| Nitro             | `Shift`                 |
| Camera (chase/hood/cinematic) | `C`           |
| Auto-brake toggle | `B`                     |
| Reset to track    | `R`                     |
| Pause             | `Esc`                   |

**Auto-brake** (toggle with `B`, or the switch on the Controls screen): when
enabled, releasing the throttle automatically applies the brakes, so you only
need the accelerator to slow for corners — no need to press the brake key.

## Mobile / touch

On touch devices an on-screen control layer appears automatically during a
race: steering buttons (bottom left), gas/brake pedals plus nitro and drift
buttons (bottom right), and pause/reset chips (top left). It supports
multi-touch (steer while braking), and the HUD scales down on small screens.
Landscape orientation is recommended.

## Physics model (`js/physics.js`)

A semi-professional slip model, not an arcade approximation:

- **Pacejka "Magic Formula" tires** — per-axle lateral force as a function of
  slip angle, with load-sensitive peak friction.
- **Friction-circle traction limit** — combined longitudinal + lateral slip
  saturates total grip, so braking mid-corner or powering out of a turn
  trades lateral grip for longitudinal, exactly like a real tire.
- **Weight transfer** — longitudinal load shift onto each axle under
  acceleration/braking, plus aerodynamic downforce that increases grip with
  speed.
- **Drivetrain** — RPM-based engine torque curve, 6/7-speed automatic
  gearbox, final drive, RWD/AWD bias, drivetrain efficiency, wheelspin.
- **Aero** — quadratic drag and speed-squared downforce.
- **Handbrake** — rear-axle lockup cuts rear lateral grip → controllable
  oversteer / drifting.
- **Nitro** — torque boost with a draining/recharging reservoir.

Fixed 120 Hz physics substeps keep the integration stable.

## Cars

| Car          | Character | Body design |
|--------------|-----------|-------------|
| FALCON GT    | Balanced, RWD | Brute muscle coupe — long hood, ducktail, quad lamps, side pipes |
| VIPER X      | Top speed, AWD, 7-speed | Low wedge hypercar — knife nose, teardrop canopy, twin-element wing |
| KITSUNE RS   | Handling, light, RWD | Cab-forward drift hatch — fender flares, roof fins, tall hatch |

## Tracks

Pick a track from the main menu (SELECT TRACK). Every track is its own world:

| Track             | Environment | Character |
|-------------------|-------------|-----------|
| DOWNTOWN CIRCUIT  | City dusk — warm haze, lit towers, streetlamps | Flat 2.4 km, technical |
| RIDGELINE RUN     | Alpine morning — crisp blue sky, lush pines | Rolling ±9 m hills, sweepers |
| CANYON SPRINT     | Desert sunset — orange haze, cacti & rocks | 1 km mountain run, ~10% grades |
| GLACIER RUN       | Snowfield noon — white terrain, snow-capped pines | 1.6 km wide sweepers, ±6 m |
| NEON DISTRICT     | Midnight city — starfield, moonlight, glowing windows | 0.9 km tight sprint, flat |

Each environment carries its own sky gradient, sun/moon glow, light colors,
fog, exposure, terrain palette and hill character. Hilly tracks carry real
elevation: road, curbs, barriers, gantry and streetlights follow the spline
height, the terrain hugs the roadbed, the camera rides it, car meshes pitch
with the gradient, and gravity along the slope slows climbs and speeds up
descents.

## Features

- Three procedural circuits (Catmull-Rom splines, optional elevation) with
  barriers, curbs, start gantry, trees, buildings, and streetlights.
- 5 AI opponents: pure-pursuit steering, curvature-based braking,
  skill-scaled cornering limits, avoidance, stuck-recovery.
- Race logic: 3 laps, live position, lap/best/last timers, wrong-way
  detection, results screen.
- HUD: analog speedometer, gear, nitro bar, minimap, drift score.
- Effects: drift smoke, nitro flames, collision sparks, camera shake,
  speed-sensitive FOV, chase/hood/cinematic cameras.
- Procedural WebAudio: RPM-layered engine, tire screech, impacts, nitro,
  countdown beeps — no audio files.

## Tests

```bash
node test_integration.js   # track + AI complete laps headlessly
node test_dom.js           # full game boot, race, HUD, finish, restart
```

## Files

```
index.html          shell + HUD + menus
css/style.css       NFS-style UI
js/physics.js       vehicle dynamics + car specs
js/track.js         circuit generation + collisions
js/ai.js            AI drivers
js/audio.js         procedural sound engine
js/effects.js       car meshes + particle system
js/game.js          renderer, race loop, HUD, states
js/main.js          menu wiring / bootstrap
vendor/three.min.js Three.js r128 (local fallback)
```
