# Now playing

lumitab glass can show what your media player is playing, with a spinning album cover and a progress bar. It is **off by default**, **Linux only**, and works with any player that supports MPRIS (Spotify, mpv, VLC, media in a browser tab, and so on).

Firefox extensions cannot see your system's media players on their own, so this feature needs a small helper program on your machine:

```
new tab page → Firefox native messaging → lumitab_player_host.py → playerctl → your player
```

Everything stays on your computer. Nothing is sent over the network.

The helper is in this folder:

- `lumitab_player_host.py`: the helper itself (Python 3, no extra packages).
- `lumitab-player.nix`: a Nix package that installs the helper and registers it with Firefox.

## Setup with Home Manager (Nix)

1. Copy `lumitab_player_host.py` and `lumitab-player.nix` from this folder into your config, for example into `modules/lumitab/`. They must stay in the same folder.

2. Register the helper with Firefox in your `home.nix`:

   ```nix
   programs.firefox = {
     enable = true;
     nativeMessagingHosts = [
       (pkgs.callPackage ./modules/lumitab/lumitab-player.nix { })
     ];
   };
   ```

   If you already have a `programs.firefox` block, just add the `nativeMessagingHosts` line to it.

3. Rebuild (`home-manager switch`, or your usual rebuild command) and **restart Firefox**.

4. Open a new tab, click the gear icon, tick **Show now playing** and press **Save**. Play something.

For reference, `lumitab-player.nix` is short. It wraps the Python script so that `playerctl` is on its `PATH`, then writes the manifest Firefox needs:

```nix
{ pkgs }:

let
  launcher = pkgs.writeShellScript "lumitab-player-host" ''
    export PATH=${pkgs.lib.makeBinPath [ pkgs.playerctl ]}:$PATH
    exec ${pkgs.python3}/bin/python3 ${./lumitab_player_host.py}
  '';
in
pkgs.writeTextDir "lib/mozilla/native-messaging-hosts/lumitab_player.json" (
  builtins.toJSON {
    name = "lumitab_player";
    description = "Now-playing bridge for lumitab glass";
    path = "${launcher}";
    type = "stdio";
    allowed_extensions = [ "lumitab@glass" ];
  }
)
```

## Setup without Home Manager (any Linux)

1. Install `playerctl` and `python3` with your package manager.

2. Put the helper somewhere permanent and make it executable:

   ```bash
   mkdir -p ~/.local/share/lumitab
   cp music-player/lumitab_player_host.py ~/.local/share/lumitab/
   chmod +x ~/.local/share/lumitab/lumitab_player_host.py
   ```

3. Create `~/.mozilla/native-messaging-hosts/lumitab_player.json`, with the path changed to your own:

   ```json
   {
     "name": "lumitab_player",
     "description": "Now-playing bridge for lumitab glass",
     "path": "/home/YOU/.local/share/lumitab/lumitab_player_host.py",
     "type": "stdio",
     "allowed_extensions": ["lumitab@glass"]
   }
   ```

4. Restart Firefox, then turn on **Show now playing** in the settings.

Firefox installed as a Snap or Flatpak runs in a sandbox that may block native messaging. This guide has not been tested there.

## Troubleshooting

The row under the clock tells you what is wrong. Hover over it for the full message.

| Message | Meaning |
|---|---|
| `No such native application lumitab_player` | Firefox cannot find the helper manifest. Check that you rebuilt, or that the file is in the right place, then restart Firefox. |
| `nativeMessaging permission is missing` | You are running a build of the extension without that permission. Install the release from addons.mozilla.org. |
| The row never appears | The helper runs, but `playerctl` sees no player. See below. |

Check that `playerctl` sees your player. On NixOS, run it through `nix shell nixpkgs#playerctl -c ...` if it is not installed:

```bash
playerctl -l
playerctl --all-players metadata --format '{{status}} | {{xesam:title}}'
```

If this prints nothing while music is playing, your player does not expose MPRIS, and the extension cannot see it.

Run the helper by hand while something is playing. You should see JSON containing `"active": true`. The leading dots are the binary length header and are normal, and `timeout` stopping the helper after 3 seconds is also normal:

```bash
timeout 3 /path/to/the/helper | tr -c '[:print:]' '.'
```

With Home Manager the path of the helper is in the registered manifest:

```bash
grep -o '"path":"[^"]*"' ~/.mozilla/native-messaging-hosts/lumitab_player.json | cut -d'"' -f4
```

Other notes:

- **No cover art:** some players do not provide a cover, and local cover files larger than about 600 KB are skipped.
- **No progress bar:** some players do not report the track position or length. Everything else still works.
- **Several players:** a playing player is preferred over a paused one.
- **Old helper:** if you update the extension but not the helper, the progress bar stays hidden. Copy the newest `lumitab_player_host.py` and rebuild.

## Turning it off

Untick **Show now playing** in the settings. To remove the helper completely, delete the `nativeMessagingHosts` line (or the manifest file) and restart Firefox.
