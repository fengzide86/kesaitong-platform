<script setup lang="ts">
withDefaults(defineProps<{ publishedCount?: number; orderCount?: number }>(), {
  publishedCount: 0,
  orderCount: 0,
})

const emit = defineEmits<{ open: [area: string] }>()

const areas = [
  { id: 'company', title: '我的公司', scene: 'office', left: 5.8, top: 13.2, color: 'red', available: false },
  { id: 'amazon', title: 'Amazon', scene: 'amazon', left: 32.1, top: 5.8, color: 'red', available: true },
  { id: 'fba', title: '亚马逊FBA仓库', scene: 'fba', left: 81.2, top: 10.7, color: 'blue', available: false },
  { id: 'first-mile', title: 'FBA头程专区', scene: 'shipping', left: 45.9, top: 31.3, color: 'red', available: false },
  { id: 'warehouse', title: '国内仓库', scene: 'warehouse', left: 1.5, top: 61.8, color: 'red', available: true },
  { id: 'agl', title: '亚马逊AGL物流', scene: 'agl', left: 22.6, top: 71.6, color: 'red', available: false },
  { id: 'freight', title: '货代中转站', scene: 'freight', left: 48.0, top: 61.8, color: 'red', available: false },
  { id: 'buyer', title: '亚马逊买家', scene: 'buyer', left: 81.2, top: 66.0, color: 'blue', available: false },
]

const resources = ['商品HS编码目录', '最新汇率查询', '重量、长度、体积转换换算工具', '卖家自行配送物流价目表', '货代以及物流价目表', '亚马逊物流AGL价目表', '自行发货至FBA仓库价目表', 'FBA相关价目表']
const beginnerLinks = ['了解亚马逊虚拟仿真系统', '运营模式介绍', '软件操作流程说明', '配送设置', '添加新商品', '产品定价', '自配送转FBA配送', 'FBA头程发货', '买家下单', '常见问题']
</script>

<template>
  <div class="v2-course">
    <svg class="scene-defs" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="v2-sky" x2="0" y2="1"><stop stop-color="#95cee8"/><stop offset="1" stop-color="#e5edf0"/></linearGradient>
        <linearGradient id="v2-office-light" x2="0" y2="1"><stop stop-color="#b5b2a3"/><stop offset="1" stop-color="#e4e0d5"/></linearGradient>
        <linearGradient id="v2-floor" x2="0" y2="1"><stop stop-color="#acb1b5"/><stop offset="1" stop-color="#d8dce0"/></linearGradient>
        <linearGradient id="v2-hair" x2="1" y2="1"><stop stop-color="#3f302a"/><stop offset="1" stop-color="#9c7d53"/></linearGradient>
        <symbol id="v2-scene-office" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="url(#v2-office-light)"/><path d="M0 4H160V15H0ZM0 82H160V100H0" fill="#8c8475"/><path d="M0 81L24 58H137L160 81" fill="#c6c3b8"/>
          <path d="M15 20H142V65H15Z" fill="#e8e5da"/><path d="M35 22H56V45H35ZM65 22H86V45H65ZM96 22H117V45H96Z" fill="#6f6d61"/><path d="M37 24H54V43H37ZM67 24H84V43H67ZM98 24H115V43H98Z" fill="#d5d8d0"/>
          <rect x="51" y="60" width="52" height="16" rx="4" fill="#aaa89e"/><rect x="49" y="52" width="56" height="16" rx="5" fill="#c0beb5"/><rect x="46" y="60" width="9" height="18" rx="2" fill="#b2b0a5"/><rect x="99" y="60" width="9" height="18" rx="2" fill="#b2b0a5"/>
          <path d="M54 84L59 76H95L101 84Z" fill="#555551"/><path d="M58 83V91M97 83V91" stroke="#777872" stroke-width="3"/><rect x="13" y="67" width="13" height="17" fill="#928a75"/><path d="M19 68V45M19 56L11 49M19 60L29 51M20 48L25 40" stroke="#547159" stroke-width="4"/><rect x="140" y="26" width="14" height="51" fill="#565d57"/><path d="M143 31H151V72H143Z" fill="#b6c6c0"/>
        </symbol>
        <symbol id="v2-scene-amazon" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="#e4e4de"/><path d="M0 0H160V8H0ZM0 81H160V100H0Z" fill="#b9b3a7"/><rect x="14" y="10" width="132" height="69" rx="5" fill="#24272a"/><rect x="20" y="16" width="120" height="56" fill="#f7f7f3"/>
          <rect x="28" y="24" width="36" height="31" fill="#e5edf3"/><circle cx="44" cy="39" r="11" fill="none" stroke="#8b9aaf" stroke-width="2"/><path d="M33 39H55M44 28V50M37 29Q51 40 37 49" stroke="#8b9aaf" fill="none"/><rect x="71" y="38" width="26" height="24" rx="3" fill="#ef8e29"/><text x="84" y="52" text-anchor="middle" font-size="10" fill="white" font-weight="700">1688</text>
          <rect x="105" y="25" width="28" height="23" rx="2" fill="#fff" stroke="#c3c3bd"/><text x="119" y="35" text-anchor="middle" font-size="8" fill="#222">amazon</text><path d="M111 38Q120 43 129 37" fill="none" stroke="#ea9d28" stroke-width="2"/>
          <path d="M14 79H146L156 93H4Z" fill="#797d80"/><path d="M26 82H134L140 88H20Z" fill="#343c41"/><path d="M38 83V87M50 83V87M62 83V87M74 83V87M86 83V87M98 83V87M110 83V87M122 83V87" stroke="#afb4b5"/><rect x="62" y="90" width="34" height="2" fill="#bbbfc0"/>
        </symbol>
        <symbol id="v2-scene-fba" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="url(#v2-sky)"/><path d="M0 17Q35 7 49 19T99 13T160 19" stroke="white" stroke-width="8" fill="none" opacity=".65"/><path d="M0 87L17 72H147L160 87V100H0Z" fill="#747e84"/>
          <rect x="9" y="32" width="142" height="49" fill="#bcc1ba"/><path d="M6 32L21 27H141L154 32Z" fill="#737b77"/><path d="M10 34H150V45H10Z" fill="#d4d8d3"/><text x="80" y="42" fill="#28343a" font-size="14" font-weight="700" text-anchor="middle">amazon</text><path d="M64 45Q81 50 97 44" fill="none" stroke="#d89126" stroke-width="2"/>
          <path d="M15 51H40V77H15ZM51 51H76V77H51ZM87 51H112V77H87ZM123 51H145V77H123Z" fill="#333d41"/><path d="M17 57H38V70H17ZM53 57H74V70H53ZM89 57H110V70H89ZM125 57H143V70H125Z" fill="#ecebd6"/><path d="M20 72H34V77H20ZM56 72H70V77H56ZM92 72H106V77H92ZM128 72H140V77H128Z" fill="#edb245"/><path d="M4 86H156M25 82V95M71 82V95M116 82V95" stroke="#cbd1d4" stroke-width="2"/>
        </symbol>
        <symbol id="v2-scene-shipping" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="url(#v2-sky)"/><path d="M0 59H160V77H0" fill="#458ca7"/><path d="M0 81H160V100H0" fill="#aaa79a"/><path d="M13 63H95L86 79H31Z" fill="#344a59"/><path d="M76 42H90V64H76" fill="#f6f1e4"/>
          <path d="M20 51H37V64H20ZM40 51H57V64H40ZM60 51H75V64H60Z" fill="#db5144"/><path d="M30 38H48V51H30ZM50 38H68V51H50Z" fill="#c9c191"/><path d="M20 55H75M34 42V64M46 42V64M62 42V64" stroke="#805c50" stroke-width="1"/>
          <path d="M111 45V22L134 18M118 45V24M119 30H138M134 18V48" stroke="#637576" stroke-width="2" fill="none"/><path d="M95 32L129 23L148 12L152 15L138 27L158 29L157 32L133 33L116 42L109 42L117 33L97 36Z" fill="#f3f5f2" stroke="#7793a1"/>
          <rect x="99" y="76" width="43" height="16" fill="#e2dfd0"/><rect x="141" y="82" width="13" height="10" fill="#30728a"/><circle cx="108" cy="94" r="4" fill="#30383e"/><circle cx="145" cy="94" r="4" fill="#30383e"/><rect x="5" y="85" width="18" height="11" fill="#d4a85f"/><rect x="29" y="83" width="20" height="13" fill="#668290"/>
        </symbol>
        <symbol id="v2-scene-warehouse" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="url(#v2-sky)"/><path d="M0 71L160 67V100H0Z" fill="#a9b8b8"/><path d="M5 47L58 28L156 39V78L5 85Z" fill="#5695a4"/><path d="M58 28V75L5 85V47Z" fill="#4b8190"/><path d="M5 47L58 28L156 39L109 58Z" fill="#bdccd0"/>
          <path d="M68 47L79 48V55L68 55ZM88 49L99 50V57L88 56ZM108 51L119 52V59L108 58ZM128 53L141 54V61L128 60Z" fill="#d0ecf0"/><path d="M73 61L90 62V78L73 79ZM106 63L123 64V77L106 78ZM138 65L151 66V76L138 77Z" fill="#263e49"/><path d="M14 50L24 46V58L14 61ZM36 42L47 38V52L36 55Z" fill="#b6d9df"/>
          <rect x="105" y="79" width="31" height="13" fill="#e1e3dc"/><path d="M135 82H147L153 90H135Z" fill="#e1e3dc"/><path d="M140 83H146L149 88H140Z" fill="#577982"/><circle cx="111" cy="94" r="4" fill="#323c42"/><circle cx="145" cy="94" r="4" fill="#323c42"/><path d="M14 91H77" stroke="#e6e5d7" stroke-width="2"/>
        </symbol>
        <symbol id="v2-scene-agl" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="url(#v2-sky)"/><path d="M0 27H160V41H0" fill="#357c99"/><path d="M0 38L160 44V100H0" fill="#8b8f83"/><path d="M4 59L76 39L157 49L89 75Z" fill="#f1f3f1"/><path d="M4 59L89 75V95L4 78Z" fill="#c2cfcc"/><path d="M89 75L157 49V69L89 95Z" fill="#dee4e0"/>
          <path d="M9 67L17 68V78L9 76ZM24 70L32 71V80L24 79ZM40 73L48 75V84L40 82ZM57 77L65 78V87L57 85ZM74 80L82 81V90L74 89Z" fill="#697e83"/><path d="M51 32H103L94 38H64Z" fill="#ebeddf"/><path d="M68 25H85V33H68Z" fill="#405260"/><path d="M0 85L27 89V97L0 94ZM110 88L148 73V79L110 95Z" fill="#d96947"/><path d="M29 90L48 94V99L29 97Z" fill="#577c9e"/>
        </symbol>
        <symbol id="v2-scene-freight" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="#c0c3b8"/><path d="M0 6L80 34L160 6M0 24L80 48L160 24M80 0V39" fill="none" stroke="#747e7d" stroke-width="4"/><path d="M0 36L72 52V100H0ZM160 36L90 52V100H160Z" fill="#8f9283"/><path d="M72 52H90L115 100H45Z" fill="#d3d4c8"/>
          <path d="M12 35V100M38 42V100M62 48V100M147 35V100M122 42V100M98 48V100" stroke="#567279" stroke-width="3"/><path d="M0 53L65 66M0 77L65 84M95 66L160 53M95 84L160 77" stroke="#697e74" stroke-width="4"/>
          <path d="M3 42L22 47V58L3 54ZM25 48L44 52V62L25 59ZM46 53L59 56V65L46 62ZM4 65L22 69V79L4 77ZM25 71L44 74V83L25 81ZM47 77L59 79V88L47 86Z" fill="#d9bd87"/><path d="M156 42L137 47V58L156 54ZM135 48L116 52V62L135 59ZM113 53L101 56V65L113 62ZM156 65L138 69V79L156 77ZM135 71L116 74V83L135 81ZM113 77L101 79V88L113 86Z" fill="#d8bca0"/>
          <path d="M66 87H91V95H66Z" fill="#343b40"/><rect x="75" y="76" width="15" height="10" fill="#e9c05b"/><path d="M62 92H92" stroke="#707d83" stroke-width="2"/>
        </symbol>
        <symbol id="v2-scene-buyer" viewBox="0 0 160 100">
          <rect width="160" height="100" fill="#c4d0cd"/><path d="M0 14H160M26 0V100M138 0V100" stroke="#e9efeb" stroke-width="9"/><path d="M45 41Q44 13 77 15Q104 14 105 47L112 87H35Z" fill="url(#v2-hair)"/><path d="M55 46Q48 34 58 32Q60 21 80 24Q91 25 96 38L92 57Q74 75 59 56Z" fill="#efd0ba"/><path d="M58 39Q64 35 69 40M80 39Q87 35 92 40" stroke="#56483f" stroke-width="2" fill="none"/><path d="M70 52Q77 58 84 51" stroke="#b97e72" stroke-width="2" fill="none"/>
          <path d="M59 61L74 70L89 61L113 100H33Z" fill="#f2f2ec"/><path d="M48 68L31 87L17 75L10 83L30 100L56 78M98 71L119 82L136 67L143 74L124 96L106 88" fill="#efd0ba"/><path d="M0 59L23 64L25 98L0 93Z" fill="#d7d853"/><path d="M3 61Q9 47 17 65" stroke="#9c9a46" fill="none" stroke-width="2"/><path d="M117 10L145 4L157 38L130 45Z" fill="#242d32"/><path d="M121 14L142 9L152 34L132 39Z" fill="#eef1e9"/><path d="M127 20L143 16M130 25L146 21M133 30L149 26" stroke="#808889" stroke-width="2"/>
        </symbol>
      </defs>
    </svg>

    <header class="course-topbar">
      <div class="topbar-content">
        <div class="course-brand" aria-label="跨境电子商务亚马逊仿真系统 V2.0 独立模拟">
          <span class="brand-emblem">跨<span>境</span></span>
          <span class="amazon-mark">a<i></i></span>
          <span class="brand-text">互联网+跨境电子商务<br>亚马逊仿真系统 <b>V2.0</b></span>
        </div>
        <nav class="course-nav" aria-label="课程导航">
          <button class="active" type="button">仿真实训</button>
          <button type="button" @click="emit('open', 'grades')">我的成绩</button>
          <button type="button" @click="emit('open', 'arbitration')">仲裁系统</button>
        </nav>
        <span class="course-user"><span class="user-emblem">学</span>林沐 <span class="user-arrow">▴</span></span>
      </div>
    </header>

    <div class="course-layout">
      <aside class="course-sidebar">
        <section class="side-panel notice-panel">
          <div class="panel-heading"><h2>通知</h2><button type="button" @click="emit('open', 'notice')">查看更多&gt;&gt;</button></div>
        </section>
        <section class="side-panel task-panel">
          <div class="panel-heading"><h2>任务要求</h2></div>
          <ul class="task-list">
            <li>卖家发布了 <strong>{{ publishedCount }}</strong> 个产品</li>
            <li>卖家处理了 <strong>{{ orderCount }}</strong> 笔订单 <span class="lost-orders">丢失的订单数&nbsp; 0</span></li>
            <li>买家必须购买 0/10 种以上产品</li>
            <li>买家必须交易 0/5 个以上的店铺</li>
          </ul>
        </section>
        <section class="side-panel resources-panel">
          <div class="panel-heading"><h2>资料查询</h2></div>
          <ul class="resource-list"><li v-for="resource in resources" :key="resource"><button type="button" @click="emit('open', 'resources')">{{ resource }}</button></li></ul>
        </section>
      </aside>

      <main class="course-main">
        <section class="map-panel">
          <div class="map-heading"><div><strong>跨境电商实训小组</strong><span>小组成员：林沐。</span></div><span class="simulation-tag">独立模拟</span></div>
          <p class="small-screen-note">课程地图保留桌面布局，可左右滑动查看入口。</p>
          <div class="map-scroll">
            <div class="map-stage">
              <svg class="world-map" viewBox="0 0 820 490" xmlns="http://www.w3.org/2000/svg" aria-label="中国至北美的跨境电商业务地图" role="img">
                <defs>
                  <pattern id="v2-map-grid" width="150" height="150" patternUnits="userSpaceOnUse"><path d="M0 0L150 150M150 0L0 150" fill="none" stroke="#8cbddd" stroke-width="1" opacity=".24"/></pattern>
                  <pattern id="v2-map-stamp" width="128" height="116" patternUnits="userSpaceOnUse"><g transform="translate(20 29)" opacity=".16" fill="none" stroke="#568cae" stroke-width="2"><ellipse cx="30" cy="33" rx="21" ry="8" transform="rotate(-12 30 33)"/><path d="M26 9Q16 23 29 65M35 15Q25 27 36 64M17 12L38 17M19 55L41 49M26 0V8M36 7V14"/><path d="M4 33L13 29M49 32L59 27"/></g></pattern>
                </defs>
                <rect width="820" height="490" fill="#cce7fb"/>
                <g fill="#f6f7f6" stroke="#dde7ed" stroke-width="1">
                  <path d="M0 91L24 88L39 99L71 91L94 95L110 78L148 92L170 87L184 102L220 87L241 102L261 98L277 113L309 110L319 126L355 120L375 145L351 168L332 171L311 195L306 221L327 235L316 258L290 257L275 233L259 237L247 267L227 268L218 250L196 257L189 277L166 265L150 270L131 252L103 249L91 230L64 226L52 200L26 192L11 165L0 168Z"/>
                  <path d="M0 155L18 152L34 167L30 184L48 202L39 219L59 241L54 275L30 289L26 323L1 331Z"/>
                  <path d="M215 263L239 276L250 300L273 309L282 340L267 369L262 404L240 428L221 403L211 369L197 350L188 314L196 281Z"/>
                  <path d="M318 238L330 251L328 275L338 290L329 306L311 298L307 280L312 262Z"/>
                  <path d="M283 301L297 310L295 334L314 355L304 364L287 345L280 326Z"/>
                  <path d="M331 306L350 313L366 333L397 340L412 355L441 358L455 382L443 393L412 385L397 369L369 363L351 349L324 338Z"/>
                  <path d="M399 383L436 370L455 380L470 407L467 432L435 446L408 435L393 418Z"/>
                  <path d="M598 18L618 10L642 22L657 52L644 85L619 83L604 61Z"/>
                  <path d="M791 148L814 150L820 230L792 235L776 216L764 191Z"/>
                  <path d="M705 325L735 334L749 354L762 361L768 379L786 390L782 410L798 430L796 464L780 482L769 456L754 436L750 411L731 396L724 371L705 350Z"/>
                </g>
                <rect width="820" height="490" fill="url(#v2-map-grid)"/>
                <rect width="820" height="490" fill="url(#v2-map-stamp)"/>
                <g class="china-shape">
                  <path transform="translate(0 16)" d="M66 207L86 200L87 188L102 190L109 180L120 188L122 207L145 211L156 205L172 211L184 199L199 202L210 194L207 180L215 171L210 162L215 158L228 164L237 173L252 168L265 176L262 191L278 197L287 207L279 218L265 214L254 225L269 237L261 250L264 266L253 271L261 287L247 294L248 311L236 321L224 313L218 329L209 324L202 313L194 326L181 318L176 305L163 310L156 300L145 303L139 289L127 289L124 278L109 276L104 264L87 267L81 255L66 254L68 239L58 232L59 216Z" fill="#963831"/>
                  <path d="M66 207L86 200L87 188L102 190L109 180L120 188L122 207L145 211L156 205L172 211L184 199L199 202L210 194L207 180L215 171L210 162L215 158L228 164L237 173L252 168L265 176L262 191L278 197L287 207L279 218L265 214L254 225L269 237L261 250L264 266L253 271L261 287L247 294L248 311L236 321L224 313L218 329L209 324L202 313L194 326L181 318L176 305L163 310L156 300L145 303L139 289L127 289L124 278L109 276L104 264L87 267L81 255L66 254L68 239L58 232L59 216Z" fill="#d44d45" stroke="#e28d84"/>
                  <path d="M221 324L231 327L227 338L222 341ZM237 313L244 311L242 322L239 326Z" fill="#bd423c"/>
                </g>
                <g class="north-america-shape">
                  <path transform="translate(0 16)" d="M556 198L586 186L621 188L638 177L657 184L662 194L681 190L696 198L713 196L727 207L746 203L757 193L773 196L785 186L796 191L787 207L764 219L748 230L733 242L723 257L710 262L700 275L681 277L670 288L664 304L651 307L644 300L641 289L624 279L606 276L589 277L576 270L561 273L544 260L540 240L532 226L539 211Z" fill="#35459f"/>
                  <path d="M556 198L586 186L621 188L638 177L657 184L662 194L681 190L696 198L713 196L727 207L746 203L757 193L773 196L785 186L796 191L787 207L764 219L748 230L733 242L723 257L710 262L700 275L681 277L670 288L664 304L651 307L644 300L641 289L624 279L606 276L589 277L576 270L561 273L544 260L540 240L532 226L539 211Z" fill="#5a77e6" stroke="#8c9fec"/>
                  <path transform="translate(0 16)" d="M475 126L492 121L498 108L515 108L515 99L533 95L538 88L562 85L568 88L588 85L604 89L625 85L631 87L631 110L615 115L604 124L587 128L571 140L553 140L550 154L527 150L511 160L498 157L485 162L470 158L458 166L450 162L459 151L476 148Z" fill="#33439e"/>
                  <path d="M475 126L492 121L498 108L515 108L515 99L533 95L538 88L562 85L568 88L588 85L604 89L625 85L631 87L631 110L615 115L604 124L587 128L571 140L553 140L550 154L527 150L511 160L498 157L485 162L470 158L458 166L450 162L459 151L476 148Z" fill="#617fe9" stroke="#8299ed"/>
                </g>
                <g stroke-width="1.7" fill="none" opacity=".86">
                  <path d="M108 156L125 232M119 309L147 252M245 360L210 294M325 134L239 206M433 207L255 239M451 311L256 252" stroke="#e98172"/>
                  <path d="M687 146L661 178M692 157L657 215M496 207L581 235M502 358L650 254M693 368L677 277" stroke="#748ee8"/>
                </g>
                <g fill="none" stroke="#f5b2a5" stroke-width="2"><circle cx="125" cy="232" r="2.5"/><circle cx="147" cy="252" r="2.5"/><circle cx="239" cy="206" r="2.5"/><circle cx="255" cy="239" r="2.5"/></g>
                <g fill="none" stroke="#a9b9f6" stroke-width="2"><circle cx="657" cy="215" r="2.5"/><circle cx="581" cy="235" r="2.5"/><circle cx="650" cy="254" r="2.5"/></g>
              </svg>
              <button v-for="area in areas" :key="area.id" class="area-node" :class="area.color" type="button" :data-area="area.id" :style="{ left: `${area.left}%`, top: `${area.top}%` }" :aria-label="`${area.title}${area.available ? '，本轮可体验' : '，查看模拟范围'}`" @click="emit('open', area.id)">
                <span class="area-picture"><svg viewBox="0 0 160 100" aria-hidden="true"><use :href="`#v2-scene-${area.scene}`"/></svg><span class="thumbnail-emblem">跨</span></span>
                <span class="area-title">{{ area.title }}</span>
              </button>
            </div>
          </div>
        </section>
        <section class="beginner-panel">
          <div class="panel-heading"><h2>新手入门</h2></div>
          <ul class="beginner-links"><li v-for="link in beginnerLinks" :key="link"><button type="button" @click="emit('open', 'guide')">{{ link }}</button></li></ul>
        </section>
      </main>
    </div>
    <footer class="course-footer"><span class="footer-emblem">跨</span><span>课赛通 · 独立模拟体验　｜　所有人物、商品及订单均为虚构样例</span></footer>
  </div>
</template>

<style scoped>
.v2-course { min-height: 840px; color: #303b4d; font-family: 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif; font-size: 14px; background: linear-gradient(180deg, #304784 66px, #334f99 115px, #aebad0 258px, #f1f1f1 383px); }
.v2-course *, .v2-course *::before, .v2-course *::after { box-sizing: border-box; }
.v2-course button { font-family: inherit; cursor: pointer; }
.scene-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.course-topbar { height: 66px; background: #252e3d; color: #fff; }
.topbar-content { width: min(1200px, calc(100% - 64px)); height: 100%; margin: 0 auto; display: flex; align-items: center; }
.course-brand { display: flex; align-items: center; flex-shrink: 0; gap: 7px; }
.brand-emblem { position: relative; display: inline-flex; justify-content: center; align-items: center; width: 48px; height: 48px; border-radius: 50%; border: 1px solid #bbc4d0; color: #173e68; background: #fff; font-size: 28px; font-family: KaiTi, serif; transform: rotate(-10deg); }
.brand-emblem > span { position: absolute; bottom: 1px; right: 6px; color: #dc842e; font-size: 16px; }
.amazon-mark { position: relative; display: inline-flex; align-items: center; justify-content: center; height: 45px; width: 45px; border-radius: 3px; background: #fff; color: #111; font-size: 49px; line-height: 1; font-weight: 700; font-family: Georgia, serif; padding-bottom: 10px; }
.amazon-mark i { position: absolute; width: 28px; height: 11px; bottom: 5px; left: 8px; border-bottom: 3px solid #f3a135; border-radius: 50%; transform: rotate(-5deg); }
.brand-text { font-size: 18px; line-height: 23px; color: #e2992e; font-weight: 700; letter-spacing: .15px; }
.brand-text b { font-size: 17px; }
.course-nav { display: flex; margin-left: auto; margin-right: 126px; align-items: center; }
.course-nav button { background: none; color: #fff; border: 0; border-left: 2px solid #111b29; height: 36px; padding: 0 19px; font-size: 16px; font-weight: 700; }
.course-nav button:hover { color: #f0a747; }
.course-user { display: flex; align-items: center; gap: 8px; white-space: nowrap; font-size: 13px; }
.user-emblem { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: #fff; color: #315a89; font-family: KaiTi, serif; font-size: 19px; }
.user-arrow { font-size: 10px; }
.course-layout { width: min(1200px, calc(100% - 64px)); margin: 20px auto 0; display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 20px; align-items: start; }
.course-sidebar { display: flex; flex-direction: column; gap: 20px; }
.side-panel, .map-panel, .beginner-panel { border-radius: 6px; background: #fff; box-shadow: 0 5px 10px #17233216; }
.side-panel { padding: 16px 15px; }
.notice-panel { height: 212px; }
.task-panel { min-height: 187px; }
.resources-panel { min-height: 276px; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; min-height: 30px; border-bottom: 1px solid #ef963e; padding-bottom: 7px; }
.panel-heading h2 { margin: 0; font-size: 16px; color: #222; font-weight: 700; }
.panel-heading > button { padding: 0; border: 0; background: none; color: #2b66bc; font-size: 12px; font-weight: 700; }
.task-list, .resource-list, .beginner-links { padding: 0; margin: 11px 0 0; list-style: none; }
.task-list { font-size: 14px; line-height: 25px; }
.task-list li::before { content: '· '; color: #232b39; }
.task-list strong { font-weight: 400; }
.lost-orders { margin-left: 10px; font-size: 12px; color: #5058ed; }
.resource-list { margin-top: 13px; line-height: 25px; }
.resource-list li, .beginner-links li { display: flex; align-items: baseline; }
.resource-list li::before, .beginner-links li::before { content: '•'; color: #ef963e; margin: 0 5px; font-size: 12px; flex-shrink: 0; }
.resource-list button, .beginner-links button { border: 0; background: none; padding: 0; color: #303b4d; text-align: left; font-size: 14px; line-height: inherit; }
.resource-list button:hover, .beginner-links button:hover { color: #2360b4; text-decoration: underline; }
.course-main { min-width: 0; }
.map-panel { padding: 16px 15px 15px; }
.map-heading { display: flex; justify-content: space-between; align-items: center; min-height: 36px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid #ef963e; gap: 8px; }
.map-heading > div { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; }
.map-heading strong { color: #2d66bd; }
.map-heading > div > span { color: #252525; }
.simulation-tag { flex-shrink: 0; font-size: 10px; color: #6d7a8a; border: 1px solid #cbd1d8; border-radius: 3px; padding: 2px 5px; }
.map-stage { position: relative; width: 100%; aspect-ratio: 820 / 490; background: #cce7fb; overflow: hidden; }
.world-map { position: absolute; display: block; inset: 0; width: 100%; height: 100%; }
.area-node { position: absolute; display: flex; flex-direction: column; width: 15%; padding: 0; background: #fff; border: 1px solid; border-radius: 4px; box-shadow: 0 9px 10px #23344175; overflow: hidden; transition: box-shadow .15s, transform .15s; z-index: 1; }
.area-node.red { border-color: #e76558; color: #df493f; }
.area-node.blue { border-color: #6d76e7; color: #536bef; }
.area-node:hover, .area-node:focus-visible { transform: translateY(-3px); box-shadow: 0 11px 14px #2334418c; z-index: 2; outline: 2px solid #fff; outline-offset: 2px; }
.area-picture { position: relative; display: block; width: 100%; aspect-ratio: 160 / 100; overflow: hidden; }
.area-picture > svg { display: block; width: 100%; height: 100%; }
.thumbnail-emblem { position: absolute; top: 4px; left: 5px; width: 21px; height: 24px; display: flex; align-items: center; justify-content: center; color: #315b88; font-size: 15px; font-family: KaiTi, serif; background: #ffffffea; border-radius: 50%; border: 1px solid #d5dde3; transform: rotate(-10deg); }
.area-title { min-height: 27px; width: 100%; display: flex; align-items: center; justify-content: center; padding: 3px 0; font-size: 14px; font-weight: 700; line-height: 20px; white-space: nowrap; border-top: 1px solid #eee; }
.small-screen-note { display: none; }
.beginner-panel { margin-top: 20px; padding: 16px 15px 17px; min-height: 130px; }
.beginner-links { display: grid; grid-template-columns: 1.6fr 1.2fr 1.2fr .65fr .8fr; grid-template-rows: repeat(2, 25px); column-gap: 14px; margin-top: 12px; }
.beginner-links li { min-width: 0; white-space: nowrap; }
.beginner-links button { font-size: 14px; line-height: 25px; }
.course-footer { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 24px 20px 21px; color: #526174; font-size: 13px; }
.footer-emblem { color: #426180; font-family: KaiTi, serif; font-size: 30px; transform: rotate(-12deg); }
@media (max-width: 1280px) {
  .topbar-content, .course-layout { width: calc(100% - 48px); }
  .course-layout { grid-template-columns: 300px minmax(0, 1fr); }
  .course-nav { margin-right: 66px; }
  .beginner-links { column-gap: 8px; }
  .beginner-links button { font-size: 12px; }
  .brand-text { font-size: 16px; }
}
@media (max-width: 1060px) {
  .course-nav { margin-right: 25px; }
  .course-nav button { padding: 0 13px; font-size: 14px; }
  .course-layout { grid-template-columns: 268px minmax(0, 1fr); gap: 16px; }
  .map-scroll { overflow-x: auto; }
  .map-stage { min-width: 670px; }
  .map-heading > div { font-size: 14px; gap: 8px; }
  .task-list { font-size: 12px; }
  .lost-orders { margin-left: 4px; font-size: 10px; }
  .beginner-links { grid-template-columns: repeat(3, 1fr); grid-template-rows: none; }
  .beginner-links button { font-size: 12px; }
  .brand-text { font-size: 14px; line-height: 21px; }
  .brand-emblem { width: 39px; height: 39px; font-size: 24px; }
  .amazon-mark { width: 36px; height: 39px; font-size: 42px; }
  .amazon-mark i { width: 23px; left: 6px; bottom: 4px; }
}
@media (max-width: 760px) {
  .v2-course { min-height: 100vh; }
  .course-topbar { height: auto; min-height: 96px; }
  .topbar-content { width: calc(100% - 28px); flex-wrap: wrap; gap: 5px; padding-top: 8px; }
  .course-brand { flex: 1; }
  .course-user { font-size: 12px; }
  .user-emblem { width: 25px; height: 25px; }
  .course-nav { order: 3; width: 100%; margin: 0; justify-content: center; }
  .course-nav button { height: 33px; padding: 0 20px; font-size: 13px; }
  .course-nav button:first-child { border-left: 0; }
  .course-layout { width: calc(100% - 28px); margin-top: 14px; display: flex; flex-direction: column; gap: 14px; }
  .course-sidebar { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; }
  .notice-panel { height: 146px; }
  .task-panel { min-height: 146px; }
  .side-panel { padding: 10px; }
  .resources-panel { display: none; }
  .panel-heading h2 { font-size: 14px; }
  .panel-heading > button { font-size: 10px; }
  .task-list { line-height: 21px; font-size: 11px; margin-top: 7px; }
  .lost-orders { display: none; }
  .course-main { width: 100%; }
  .map-panel { padding: 10px; }
  .map-heading { min-height: 31px; margin-bottom: 5px; }
  .map-heading > div { display: block; font-size: 12px; line-height: 20px; }
  .map-heading > div > span { margin-left: 5px; font-weight: 400; }
  .small-screen-note { display: block; color: #707c8c; font-size: 11px; line-height: 18px; margin: 5px 0 7px; }
  .map-stage { min-width: 720px; }
  .beginner-panel { margin-top: 14px; padding: 10px; }
  .beginner-links { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 5px; margin-top: 8px; }
  .beginner-links button { font-size: 11px; }
  .course-footer { font-size: 10px; padding: 18px 14px; gap: 7px; }
  .footer-emblem { font-size: 24px; }
}
</style>
