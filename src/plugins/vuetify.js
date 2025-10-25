import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'   // ← иконсет MDI
import '@mdi/font/css/materialdesignicons.css'        // ← CSS со шрифтом-иконками

export const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
})