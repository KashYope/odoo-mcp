export const ALLOWED_MODELS: Record<string, { fields: string[]; writable: boolean }> = {
  'res.partner': {
    fields: [
      'id',
      'name',
      'display_name',
      'email',
      'phone',
      'mobile',
      'company_name',
      'type',
      'street',
      'city',
      'zip',
      'country_id',
      'is_company',
      'parent_id',
      'category_id',
    ],
    writable: true,
  },
  'sale.order': {
    fields: [
      'id',
      'name',
      'state',
      'partner_id',
      'amount_total',
      'currency_id',
      'date_order',
      'team_id',
      'company_id',
      'user_id',
    ],
    writable: true,
  },
  'account.move': {
    fields: [
      'id',
      'name',
      'state',
      'move_type',
      'partner_id',
      'invoice_date',
      'amount_total',
      'currency_id',
      'payment_state',
      'company_id',
    ],
    writable: false,
  },
  'product.product': {
    fields: [
      'id',
      'name',
      'list_price',
      'standard_price',
      'type',
      'categ_id',
      'uom_id',
      'company_id',
      'default_code',
    ],
    writable: false,
  },
  'stock.picking': {
    fields: [
      'id',
      'name',
      'state',
      'partner_id',
      'scheduled_date',
      'picking_type_id',
      'location_id',
      'location_dest_id',
      'company_id',
    ],
    writable: false,
  },
  'mrp.production': {
    fields: [
      'id',
      'name',
      'state',
      'product_id',
      'product_qty',
      'date_planned_start',
      'date_planned_finished',
      'company_id',
    ],
    writable: false,
  },
};

export const BUSINESS_METHOD_WHITELIST: Record<string, string[]> = {
  'sale.order': ['action_confirm'],
  'account.move': ['action_post'],
  'stock.picking': ['button_validate'],
  'mrp.production': ['button_mark_done'],
};

export const PII_FIELDS = [
  'email',
  'phone',
  'mobile',
  'street',
  'street2',
  'zip',
  'city',
];

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 5;

export type ExecutionMode = 'plan' | 'dry_run' | 'confirm';

export const SAFE_MODELS = Object.keys(ALLOWED_MODELS);

export const WRITABLE_MODELS = SAFE_MODELS.filter((model) => ALLOWED_MODELS[model].writable);

export const DRY_RUN_OPERATIONS = ['create', 'write', 'unlink', 'call_kw'] as const;
