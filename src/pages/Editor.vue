<template>
    <v-card class="pa-4">
        <v-card-title class="text-h5">Редактор</v-card-title>
        <v-card-subtitle>Базовые операции с видео прямо в браузере</v-card-subtitle>

        <v-tabs v-model="tab" class="mt-4">
            <v-tab value="trim">Обрезка</v-tab>
            <v-tab value="merge">Склейка</v-tab>
            <v-tab value="snapshot">Снимок кадра</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-4">
            <!-- Обрезка -->
            <v-window-item value="trim">
                <TrimEditor />
            </v-window-item>

            <!-- Склейка -->
            <v-window-item value="merge">
                <MergeEditor />
            </v-window-item>

      <v-window-item value="snapshot">
        <SnapshotEditor />
      </v-window-item>
        </v-window>
    </v-card>
</template>

<script>
import TrimEditor from '@/components/TrimEditor.vue'
import MergeEditor from '@/components/MergeEditor.vue'
import SnapshotEditor from '@/components/SnapshotEditor.vue'

export default {
    name: 'Editor',
    components: { TrimEditor, MergeEditor, SnapshotEditor },
    data() {
        return { tab: 'trim' }
    },
}
</script>
