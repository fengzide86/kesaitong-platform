<template>
  <ConnectionNotice />
  <template v-if="!connection.shouldWarn">
    <AnnouncementBanner v-if="customerAnnouncements" :hide-banner="showUpdateNotice || hideAnnouncementBanner" />
    <UpdateNoticeBar v-if="showUpdateNotice" />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AnnouncementBanner from '@/components/AnnouncementBanner.vue'
import ConnectionNotice from '@/features/connectivity/ConnectionNotice.vue'
import UpdateNoticeBar from '@/features/updates/UpdateNoticeBar.vue'
import { useAnnouncementStore } from '@/features/announcements/store'
import { useConnectionStore } from '@/stores/connection'
import { useUpdateStore } from '@/features/updates/store'

const props = withDefaults(defineProps<{ suppressUpdate?: boolean; hideAnnouncementBanner?: boolean; customerAnnouncements?: boolean }>(), { customerAnnouncements: true })
const announcements = useAnnouncementStore()
const connection = useConnectionStore()
const updates = useUpdateStore()
const showUpdateNotice = computed(() => updates.shouldShowNotice && !props.suppressUpdate && (!props.customerAnnouncements || !announcements.critical))
</script>
