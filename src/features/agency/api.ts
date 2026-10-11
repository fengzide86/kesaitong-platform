import { z } from 'zod'
import { api, type ApiQueryParams } from '@/utils/api'
import { downloadApiFile } from '@/utils/api/download'
import type { components } from '@/shared/api/openapi.generated'
import {
  agencySchema, customerSchema, orderSchema, licenseSchema, serviceRequestSchema, planSchema,
  pageSchema, summarySchema, type Agency, type Customer, type AgencyOrder, type AgencyLicense,
  type ServiceRequest, type AgencyPlan, type AgencySummary, type Page,
} from './model'
import {
  commissionPolicySchema, commissionSummarySchema, commissionPreviewSchema,
  commissionEntrySchema, commissionSettlementSchema, commissionPolicyUpdateSchema, commissionSettlementConfirmSchema,
  commissionMonthSchema, type CommissionPolicy, type CommissionSummary,
  type CommissionEntry, type CommissionPreview, type CommissionSettlement, type CommissionSettlementConfirm,
} from './commission-model'

const readOptions: { cache?: boolean; responseMode: 'raw' } = { cache: false, responseMode: 'raw' }
type Schemas = components['schemas']
export const agencyApi = {
  async summary(params: ApiQueryParams = {}): Promise<AgencySummary> {
    return summarySchema.parse(await api.get('/api/agency/summary', params, { cache: false }))
  },
  async agencies(params: ApiQueryParams = {}): Promise<Page<Agency>> {
    return pageSchema(agencySchema).parse(await api.get('/api/agency/agencies', params, readOptions))
  },
  async customers(params: ApiQueryParams = {}): Promise<Page<Customer>> {
    return pageSchema(customerSchema).parse(await api.get('/api/agency/customers', params, readOptions))
  },
  async customer(id: number): Promise<Customer> {
    return customerSchema.parse(await api.get(`/api/agency/customers/${id}`, {}, { cache: false }))
  },
  async order(id: number): Promise<AgencyOrder> {
    return orderSchema.parse(await api.get(`/api/agency/orders/${id}`, {}, { cache: false }))
  },
  async license(id: number): Promise<AgencyLicense> {
    return licenseSchema.parse(await api.get(`/api/agency/licenses/${id}`, {}, { cache: false }))
  },
  async request(id: number): Promise<ServiceRequest> {
    return serviceRequestSchema.parse(await api.get(`/api/agency/requests/${id}`, {}, { cache: false }))
  },
  async orders(params: ApiQueryParams = {}): Promise<Page<AgencyOrder>> {
    return pageSchema(orderSchema).parse(await api.get('/api/agency/orders', params, readOptions))
  },
  async licenses(params: ApiQueryParams = {}): Promise<Page<AgencyLicense>> {
    return pageSchema(licenseSchema).parse(await api.get('/api/agency/licenses', params, readOptions))
  },
  async requests(params: ApiQueryParams = {}): Promise<Page<ServiceRequest>> {
    return pageSchema(serviceRequestSchema).parse(await api.get('/api/agency/requests', params, readOptions))
  },
  async plans(): Promise<AgencyPlan[]> {
    return z.array(planSchema).parse(await api.get('/api/agency/plans', {}, { cache: false }))
  },
  async createAgency(payload: Schemas['AgencyWrite']): Promise<Agency> {
    return z.object({ data: agencySchema }).parse(await api.post('/api/agency/agencies', payload)).data
  },
  async updateAgency(id: number, payload: Schemas['AgencyUpdate']): Promise<Agency> {
    return agencySchema.parse(await api.patch(`/api/agency/agencies/${id}`, payload))
  },
  async createCustomer(payload: Schemas['CustomerCreate']): Promise<Customer> {
    return z.object({ data: customerSchema }).parse(await api.post('/api/agency/customers', payload)).data
  },
  async updateCustomer(id: number, payload: Schemas['CustomerUpdate']): Promise<Customer> {
    return customerSchema.parse(await api.patch(`/api/agency/customers/${id}`, payload))
  },
  async createOrder(payload: Schemas['AgencyOrderCreate']): Promise<AgencyOrder> {
    return z.object({ data: orderSchema }).parse(await api.post('/api/agency/orders', payload)).data
  },
  async markPaid(id: number): Promise<AgencyOrder> {
    return z.object({ data: orderSchema }).parse(await api.post(`/api/agency/orders/${id}/mark-paid`)).data
  },
  async deliver(id: number): Promise<AgencyOrder> {
    return z.object({ data: orderSchema }).parse(await api.post(`/api/agency/orders/${id}/deliver`)).data
  },
  async refundOrder(id: number, reason: string): Promise<AgencyOrder> {
    const payload: Schemas['OrderTransitionRequest'] = { reason }
    await api.post(`/api/orders/${id}/refund`, payload)
    return agencyApi.order(id)
  },
  async cancelOrder(id: number, reason: string): Promise<AgencyOrder> {
    const payload: Schemas['OrderTransitionRequest'] = { reason }
    await api.post(`/api/orders/${id}/cancel`, payload)
    return agencyApi.order(id)
  },
  async createRequest(payload: Schemas['AgencyRequestCreate']): Promise<ServiceRequest> {
    return z.object({ data: serviceRequestSchema }).parse(await api.post('/api/agency/requests', payload)).data
  },
  async respond(id: number, payload: Schemas['AgencyRequestResolve']): Promise<ServiceRequest> {
    return serviceRequestSchema.parse(await api.patch(`/api/agency/requests/${id}`, payload))
  },
  exportOrders(params: ApiQueryParams): Promise<Blob> { return downloadApiFile('/api/agency/orders/export', params) },
  async commissionPolicy(agencyId: number): Promise<CommissionPolicy> {
    return z.object({ data: commissionPolicySchema }).parse(await api.get(`/api/agency/agencies/${agencyId}/commission-policy`, {}, readOptions)).data
  },
  async updateCommissionPolicy(agencyId: number, rate: number | null, expectedRate: number | null): Promise<CommissionPolicy> {
    const payload = commissionPolicyUpdateSchema.parse({ rate, expected_rate: expectedRate })
    return z.object({ data: commissionPolicySchema }).parse(await api.put(`/api/agency/agencies/${agencyId}/commission-policy`, payload)).data
  },
  async commissionSummary(agencyId: number): Promise<CommissionSummary> {
    return z.object({ data: commissionSummarySchema }).parse(await api.get(`/api/agency/agencies/${agencyId}/commission-summary`, {}, readOptions)).data
  },
  async commissionEntries(agencyId: number, params: { page?: number; page_size?: number; settled?: boolean } = {}): Promise<Page<CommissionEntry>> {
    return pageSchema(commissionEntrySchema).parse(await api.get(`/api/agency/agencies/${agencyId}/commissions`, params, readOptions))
  },
  async commissionSettlements(agencyId: number, params: { page?: number; page_size?: number } = {}): Promise<Page<CommissionSettlement>> {
    return pageSchema(commissionSettlementSchema).parse(await api.get(`/api/agency/agencies/${agencyId}/commission-settlements`, params, readOptions))
  },
  async commissionPreview(agencyId: number, month: string): Promise<CommissionPreview> {
    return z.object({ data: commissionPreviewSchema }).parse(await api.get(`/api/agency/agencies/${agencyId}/commission-settlement-preview`, { month: commissionMonthSchema.parse(month) }, readOptions)).data
  },
  async confirmCommissionSettlement(agencyId: number, payload: CommissionSettlementConfirm): Promise<CommissionSettlement> {
    return z.object({ data: commissionSettlementSchema }).parse(await api.post(`/api/agency/agencies/${agencyId}/commission-settlements`, commissionSettlementConfirmSchema.parse(payload))).data
  },
}
