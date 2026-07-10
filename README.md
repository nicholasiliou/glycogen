
# [Live Page](nicholasiliou.github.io/marathon/)
# Gallery
<img width="1920" height="1080" alt="marathon_00000 (7)" src="https://github.com/user-attachments/assets/bb191d72-ce90-42d9-9356-8db680ac40ad" />
<img width="1920" height="1080" alt="marathon_00000 (5)" src="https://github.com/user-attachments/assets/e1e34cd4-fed9-4953-8c9d-14d1beae6663" />
<img width="1920" height="1080" alt="marathon_00003 (1)" src="https://github.com/user-attachments/assets/c54dc92a-832e-4ef1-a58d-8ef87845d84f" />
<img width="1920" height="1080" alt="marathon_00006" src="https://github.com/user-attachments/assets/911ea0dc-1c83-4afe-9a05-891c0384ccaa" />

<img width="1920" height="1080" alt="marathon_00001 (1) (1)" src="https://github.com/user-attachments/assets/f1e99656-8c31-46d5-b5e2-e562c0f36186" />

# Manual
## UI Controls
### Header
#### Preview Dials
On the left hand side of the header there are `preview dials`, they can be used to discover `plugins` and `shaders`.
#### Plugin preview
`Plugins` can generate visuals from nothing
- Click it's dial to iterate through available `plugins`
- Click this preview to `focus` the plugins
#### Shader preview
`Shaders` modify existing visuals
- Click it's dial to iterate through available `shaders`
- Click this preview to `focus` the shaders
#### Banks
On the right hand side of the header there are `bank slots`, they automatically store your current plugin and shader parameters.
- Click on an `empty` bank to `load` and `activate` a plugin
- Banks stack visuals vertically, the leftmost element is at the top, like a staircase, click and drag to rearrange the order.

### Control Panel
Click the little arrow on the right side of the screen to open the `controls`, they allow you to edit the parameters of the focused plugin
- Sliders adjust continuous values
- Buttons trigger actions (e.g., randomize, reset)
- Parameters are saved with each bank

### Controller
The `assign` tab wires plugin parameters and app functions to your controller.
- Drag a parameter onto a `widget` on the controller overlay to map it
- Drag a mapped parameter back to the assign panel to remove the binding

If you have a MIDI controller connected:
- Click on a `widget` to learn the MIDI mapping
If you don't have a MIDI controller, you can emulate one via `pop out`.

## Export / Import
Click the download icon in the header to export stills or videos.
- **Still**: Snapshots the current live frame as PNG
- **Video**: Records the next N seconds of live playback

Hint: Stills include `Metadata`. If you or a friend saved a still and want to edit it again, simply drag and drop it onto the Canvas.

# Dev
## Setup
Prerequisites: node
```
npm i
npm run dev
```
## Debug functions

Add #db to the URL to inspect all the database entries
Add #admin to the URL to unlock a default override button inside the `Control Panel`



