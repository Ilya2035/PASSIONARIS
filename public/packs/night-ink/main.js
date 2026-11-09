// Example pack script: runs once the world is up. api = {version, pack, hud, world, globe, scene, gcam}.
export function install(api) {
  api.hud.toast(`<b>Мод «${api.pack.name}»</b> подключён · v${api.pack.version}`, 4000);
}
