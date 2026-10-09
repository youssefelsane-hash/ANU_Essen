/** Ticket categories in plain words for customers and staff. */
export const TICKET_CATEGORY_LABELS: Record<string, [string, string]> = {
  ORDER: ['مشكلة في الطلب (ناقص / غلط)', 'Problem with the order (missing / wrong)'],
  FOOD: ['جودة الأكل', 'Food quality'],
  DELIVERY: ['التوصيل أو التأخير', 'Delivery or delay'],
  PAYMENT: ['الدفع أو الاسترجاع', 'Payment or refund'],
  APP: ['مشكلة في الموقع', 'Problem with the website'],
  SUGGESTION: ['اقتراح', 'Suggestion'],
  OTHER: ['حاجة تانية', 'Something else'],
};

export const TICKET_STATUS_LABELS: Record<string, [string, string]> = {
  OPEN: ['مستني رد', 'Waiting for reply'],
  ANSWERED: ['اتردّ عليها', 'Answered'],
  CLOSED: ['مقفولة', 'Closed'],
};
