import { app } from '../../scripts/app.js'

app.registerExtension({
  name: 'ComfyArt.TopBar',
  actionBarButtons: [{ icon: 'icon-[lucide--palette]', label: 'ComfyArt', tooltip: 'Open ComfyArt', onClick: () => location.assign('/comfyart/') }],
})
