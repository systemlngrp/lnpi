export const mandatoryFieldsByView = {
  production_processing_form: {
    date: true,
    productionId: true,
    machineId: true,
    shift: true,
    qty: true,
    operatorId: true,
  },
  company_form: {
    name: true,
    gstSupplyType: true,
  },
  supplier_form: {
    name: true,
    gstSupplyType: true,
  },
  invoice_form: {
    gstSupplyType: true,
  },
} as const;

export type MandatoryViewKey = keyof typeof mandatoryFieldsByView;

export function isMandatoryField(viewKey: MandatoryViewKey, fieldKey: string) {
  const view = mandatoryFieldsByView[viewKey] as Record<string, boolean> | undefined;
  return Boolean(view?.[fieldKey]);
}

