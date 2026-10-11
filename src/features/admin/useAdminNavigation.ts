import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { authService } from '@/utils/auth'
import { getAdminNavigation, getAdminNavigationSelection } from './navigation'

export function useAdminNavigation() {
  const route = useRoute()
  const role = ref(authService.getRole())
  const refreshRole = () => { role.value = authService.getRole() }
  const events = ['toolbox:user-updated', 'toolbox:auth-cleared', 'storage'] as const
  for (const event of events) window.addEventListener(event, refreshRole)
  watch(() => route.fullPath, refreshRole)
  onUnmounted(() => { for (const event of events) window.removeEventListener(event, refreshRole) })
  const areas = computed(() => getAdminNavigation(role.value))
  const selection = computed(() => getAdminNavigationSelection(areas.value, route))
  return { route, areas, selection }
}
