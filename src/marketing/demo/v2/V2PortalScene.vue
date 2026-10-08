<script setup lang="ts">
defineProps<{ kind: 'selection' | 'purchasing' | 'seller' }>()
</script>

<template>
  <svg class="v2-portal-scene" viewBox="0 0 240 150" aria-hidden="true">
    <rect width="240" height="150" fill="#d5dbe0" />
    <path d="M0 0H240V111H0Z" fill="#e3e6e7" /><path d="M0 112H240V150H0Z" fill="#b2aaa0" />
    <path d="M0 18H31V95H0ZM209 18H240V95H209Z" fill="#bdd0d6" />
    <rect x="22" y="17" width="196" height="105" rx="6" fill="#31383d" />
    <rect x="29" y="24" width="182" height="87" fill="#fafafa" />
    <g v-if="kind === 'selection'">
      <rect x="29" y="24" width="182" height="16" fill="#2c445d" />
      <text x="40" y="35" font-size="9" fill="#fff">Product Research</text>
      <rect x="38" y="47" width="72" height="8" fill="#dfe5e9" /><rect x="116" y="47" width="44" height="8" fill="#dee7eb" />
      <path d="M39 99V77H50V99ZM56 99V69H67V99ZM73 99V74H84V99ZM90 99V59H101V99Z" fill="#75a6b8" />
      <path d="M38 101H105M37 59V102" stroke="#9caeb7" fill="none" />
      <rect x="119" y="62" width="81" height="7" fill="#dbe3e7" /><rect x="119" y="75" width="65" height="5" fill="#dbe3e7" /><rect x="119" y="87" width="75" height="5" fill="#dbe3e7" /><rect x="119" y="99" width="58" height="5" fill="#dbe3e7" />
      <circle cx="178" cy="66" r="20" fill="#f6fbfd" fill-opacity=".6" stroke="#526d82" stroke-width="6" /><path d="M193 81L215 103" stroke="#455e71" stroke-width="9" stroke-linecap="round" />
    </g>
    <g v-else-if="kind === 'purchasing'">
      <rect x="29" y="24" width="182" height="22" fill="#ed6b21" /><text x="42" y="41" font-size="20" font-weight="700" fill="#fff" font-family="Arial">1688</text>
      <rect x="114" y="31" width="81" height="8" fill="#fff" opacity=".9" />
      <g fill="#e0d9c5"><rect x="40" y="54" width="45" height="37" /><rect x="96" y="54" width="45" height="37" /><rect x="151" y="54" width="45" height="37" /></g>
      <path d="M45 83V69H77V83ZM102 83V65H131V83ZM158 80L163 65H184L189 80Z" fill="#999a8c" /><path d="M47 69L59 62H73L77 69M103 65L113 58H126L131 65" fill="#c7b894" />
      <g fill="#bac4c9"><rect x="40" y="97" width="45" height="4" /><rect x="96" y="97" width="45" height="4" /><rect x="151" y="97" width="45" height="4" /></g>
      <g fill="#d88545"><rect x="40" y="105" width="20" height="3" /><rect x="96" y="105" width="20" height="3" /><rect x="151" y="105" width="20" height="3" /></g>
    </g>
    <g v-else>
      <rect x="29" y="24" width="182" height="16" fill="#edf0f2" /><text x="37" y="35" font-size="10" font-family="Arial" fill="#333">seller<tspan fill="#d68720"> central</tspan></text>
      <rect x="125" y="29" width="78" height="6" fill="#fff" stroke="#c6cbd0" stroke-width=".6" />
      <path d="M29 43H211" stroke="#c7ccd0" /><g fill="#688393"><rect x="36" y="47" width="17" height="3" /><rect x="60" y="47" width="17" height="3" /><rect x="84" y="47" width="17" height="3" /><rect x="108" y="47" width="17" height="3" /></g>
      <rect x="36" y="57" width="73" height="8" fill="#e5e8e9" /><rect x="37" y="73" width="168" height="9" fill="#eef0f1" />
      <path d="M37 84H205M37 96H205M37 107H205M52 82V109M112 82V109M169 82V109" stroke="#d2d8dc" stroke-width=".7" />
      <path d="M41 87H48V92H41ZM41 99H48V104H41Z" fill="#92aab6" />
      <g fill="#8296a2"><rect x="58" y="87" width="46" height="3" /><rect x="58" y="100" width="38" height="3" /><rect x="117" y="87" width="40" height="3" /><rect x="117" y="100" width="44" height="3" /></g>
      <g fill="#dab165"><rect x="177" y="86" width="20" height="5" /><rect x="177" y="99" width="20" height="5" /></g>
    </g>
    <path d="M22 122H218L233 138H7Z" fill="#707c86" /><path d="M37 125H203L211 133H29Z" fill="#3d4852" /><path d="M69 126V132M90 126V132M111 126V132M132 126V132M153 126V132M174 126V132" stroke="#95a1a8" /><path d="M98 135H142" stroke="#d3d8d9" stroke-width="2" />
  </svg>
</template>

<style scoped>
.v2-portal-scene { display: block; width: 100%; height: auto; }
</style>
