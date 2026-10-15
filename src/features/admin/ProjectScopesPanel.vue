<template>
  <section class="panel" aria-labelledby="project-scope-title">
    <h2 id="project-scope-title">项目与已核验课程</h2>
    <p class="hint">把订单项目关联到已审核的现场课程。项目名称不是执行凭证；未审核课程不会因购买套餐而开放。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="notice">{{ message }}</p>
    <form @submit.prevent="save"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields">
      <label>订单使用的项目编号<input v-model="form.project_id" required :readonly="form.expected_revision > 0"></label>
      <label>适用站点<select v-model="form.site_origin" required :disabled="form.expected_revision > 0" @change="form.course_refs = []"><option value="" disabled>选择已审核站点</option><option v-for="origin in origins" :key="origin">{{ origin }}</option></select></label>
      <label>场景<select v-model="form.mode" @change="form.course_refs = []"><option value="training">实训</option><option value="competition">比赛</option></select></label>
      <label>状态<select v-model="form.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
    </div>
    <p v-if="!courses.length" class="hint">此站点／场景暂无已审核课程，不能新开放自动执行。浏览范围仍由场景策略独立管理。</p>
    <label v-for="course in courses" :key="course.ref" class="check"><input v-model="form.course_refs" type="checkbox" :value="course.ref">{{ course.name }} · {{ course.evidence }} · {{ course.ref.slice(0, 12) }}</label>
    <div class="actions"><button class="primary" :disabled="!form.course_refs.length">保存映射</button><button type="button" @click="reset">新建映射</button><button type="button" @click="run(load)">刷新</button></div>
    </fieldset></form>
    <div class="table-wrap"><table><thead><tr><th>项目</th><th>站点</th><th>场景</th><th>课程数 / 状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.project_id }}</td><td>{{ row.site_origin }}</td><td>{{ row.mode === 'training' ? '实训' : '比赛' }}</td><td>{{ row.course_refs.length }} / {{ row.status }}</td><td><button :disabled="busy" @click="edit(row)">编辑</button></td></tr></tbody></table></div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '@/utils/api'
import { listTargetProfileReviews } from '@/utils/api/target-profiles'
import type { SignedTargetProfile } from '@/shared/ipc/target-contract'
import { useFrameworkTask } from './useFrameworkTask'
interface Scope { id: number; project_id: string; site_origin: string; mode: 'training' | 'competition'; course_refs: string[]; status: 'active' | 'disabled'; revision: number }
const { busy, error, message, run } = useFrameworkTask()
const rows = ref<Scope[]>([]), profiles = ref<SignedTargetProfile[]>([])
const blank = () => ({ expected_revision: 0, project_id: '', site_origin: '', mode: 'training' as 'training' | 'competition', course_refs: [] as string[], status: 'active' as 'active' | 'disabled' })
const form = reactive(blank())
const approved = computed(() => profiles.value.filter(p => p.profile.reviewStatus === 'approved'))
const origins = computed(() => [...new Set(approved.value.map(p => new URL(p.profile.entryUrl).origin))])
const courses = computed(() => [...new Map(approved.value.filter(p => new URL(p.profile.entryUrl).origin === form.site_origin).flatMap(p => (p.profile.executionScopes || []).filter(s => String(s.scenario) === form.mode).map(s => [s.courseRef, { ref: s.courseRef, name: p.profile.name, evidence: s.evidenceRef }] as const))).values()])
function reset() { Object.assign(form, blank()) }
function edit(row: Scope) { Object.assign(form, { expected_revision: row.revision, project_id: row.project_id, site_origin: row.site_origin, mode: row.mode, course_refs: [...row.course_refs], status: row.status }) }
async function load() { [rows.value, profiles.value] = await Promise.all([api.get<Scope[]>('/api/scenarios/projects', {}, { cache: false }), listTargetProfileReviews()]) }
async function save() { await run(async () => { await api.put('/api/scenarios/projects', { ...form }); await load(); const updated = rows.value.find(r => r.project_id === form.project_id && r.site_origin === form.site_origin); if (updated) edit(updated) }, '项目映射已保存；未验收能力仍不会开放') }
onMounted(() => run(load))
</script>
