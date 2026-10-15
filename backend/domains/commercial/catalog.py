"""Public-facing offer templates only; no internal costs or distribution data."""

from schemas.commercial import OfferDefinition

TRIAL_CAPABILITIES = ("company.register", "product.create", "template.create")
CALCULATORS = ["freight.quote", "selection_compare", "cost_calculator", "price_calculator", "profit_calculator"]
BASIC_CAPABILITIES = [*TRIAL_CAPABILITIES, *CALCULATORS]
FULL_CAPABILITIES = [*BASIC_CAPABILITIES, "ad_script", "flash_sale", "coupon", "fba_agl", "ship_script"]
CAPABILITY_ALIASES = {
    "company": "company.register", "register_company": "company.register",
    "listing_script": "product.create", "ali_listing": "product.create",
    "logistics_standard": "template.create", "logistics_cost": "freight.quote", "ali_ship": "ship_script",
}


def canonical_offer(definition: OfferDefinition) -> OfferDefinition:
    value = definition.model_dump()
    value["allowed_capabilities"] = [CAPABILITY_ALIASES.get(capability, capability) for capability in definition.allowed_capabilities]
    return OfferDefinition.model_validate(value)


def draft_templates() -> list[dict]:
    """Explicit administrator action imports these as drafts, never on startup."""
    specs = [
        ("free-trial", "免费体验", "0", "trial", BASIC_CAPABILITIES, [], "公司注册 1 次、上品 1 个、物流模板 1 次，三项全部赠送，含对应计算"),
        ("competition-basic", "比赛基础包", "49", "competition", BASIC_CAPABILITIES, [], "约定本次比赛期间：注册、上品、物流模板及对应计算"),
        ("competition-full", "比赛完整包", "199", "competition", FULL_CAPABILITIES, [], "基础包加广告、秒杀、优惠券、FBA 配送、订单发货，以已开放能力为准"),
        ("competition-guided", "比赛工具与指导包", "599", "competition", FULL_CAPABILITIES,
         [{"code": "materials-full", "count": 1}, {"code": "diagnosis", "count": 1}, {"code": "group-qa", "count": 1}, {"code": "appointment", "count": 3, "minutes_per_unit": 30}],
         "完整工具，资料 1 套、诊断 1 次、集中答疑 1 次、3 次各 30 分钟预约答疑"),
        ("training-full", "实训完整工具包", "69", "training", FULL_CAPABILITIES, [], "本次约定实训项目全程，绑定适用平台和明确结束时间，不含比赛"),
        ("single-tool-39", "单个工具", "39", "single_tool", [], [], "单个工具 39 元，需选择一个已开放工具并绑定约定比赛或实训项目；此模板不能直接下单"),
    ]
    for sku, name, price, code, minutes in [
        ("service-materials-topic", "专题资料", "29", "materials-topic", 0),
        ("service-materials-full", "完整资料", "79", "materials-full", 0),
        ("service-diagnosis", "账号诊断", "99", "diagnosis", 0),
        ("service-group-qa", "集中答疑", "50", "group-qa", 0),
        ("service-appointment", "预约答疑", "99", "appointment", 30),
    ]:
        specs.append((sku, name, price, "service", [], [{"code": code, "count": 1, "minutes_per_unit": minutes}], "按约定范围履约，不包含持续跟进或工具授权"))
    return [{"sku": sku, "definition": OfferDefinition(
        name=name, price=price, business_line=line,
        term_type="service_fulfillment" if line == "service" else "project_end",
        allowed_capabilities=caps, services=services, description=description,
        availability="consult",
    ).model_dump(mode="json")} for sku, name, price, line, caps, services, description in specs]
