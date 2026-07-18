export type LatamCountry = {
  code: string;
  name: string;
  dialCode: string;
  example: string;
  currency: string;
  locale: string;
};

export const LATAM_COUNTRIES: LatamCountry[] = [
  { code: "AR", name: "Argentina", dialCode: "54", example: "91123456789", currency: "ARS", locale: "es-AR" },
  { code: "BO", name: "Bolivia", dialCode: "591", example: "71234567", currency: "BOB", locale: "es-BO" },
  { code: "BR", name: "Brasil", dialCode: "55", example: "11912345678", currency: "BRL", locale: "pt-BR" },
  { code: "CL", name: "Chile", dialCode: "56", example: "912345678", currency: "CLP", locale: "es-CL" },
  { code: "CO", name: "Colombia", dialCode: "57", example: "3001112233", currency: "COP", locale: "es-CO" },
  { code: "CR", name: "Costa Rica", dialCode: "506", example: "83123456", currency: "CRC", locale: "es-CR" },
  { code: "CU", name: "Cuba", dialCode: "53", example: "51234567", currency: "CUP", locale: "es-CU" },
  { code: "DO", name: "República Dominicana", dialCode: "1", example: "8092345678", currency: "DOP", locale: "es-DO" },
  { code: "EC", name: "Ecuador", dialCode: "593", example: "991234567", currency: "USD", locale: "es-EC" },
  { code: "SV", name: "El Salvador", dialCode: "503", example: "70123456", currency: "USD", locale: "es-SV" },
  { code: "GT", name: "Guatemala", dialCode: "502", example: "51234567", currency: "GTQ", locale: "es-GT" },
  { code: "HT", name: "Haití", dialCode: "509", example: "34123456", currency: "HTG", locale: "fr-HT" },
  { code: "HN", name: "Honduras", dialCode: "504", example: "91234567", currency: "HNL", locale: "es-HN" },
  { code: "MX", name: "México", dialCode: "52", example: "5512345678", currency: "MXN", locale: "es-MX" },
  { code: "NI", name: "Nicaragua", dialCode: "505", example: "81234567", currency: "NIO", locale: "es-NI" },
  { code: "PA", name: "Panamá", dialCode: "507", example: "61234567", currency: "PAB", locale: "es-PA" },
  { code: "PY", name: "Paraguay", dialCode: "595", example: "981123456", currency: "PYG", locale: "es-PY" },
  { code: "PE", name: "Perú", dialCode: "51", example: "912345678", currency: "PEN", locale: "es-PE" },
  { code: "PR", name: "Puerto Rico", dialCode: "1", example: "7872345678", currency: "USD", locale: "es-PR" },
  { code: "UY", name: "Uruguay", dialCode: "598", example: "91234567", currency: "UYU", locale: "es-UY" },
  { code: "VE", name: "Venezuela", dialCode: "58", example: "4121234567", currency: "VES", locale: "es-VE" },
];

export const getLatamCountry = (code: string) =>
  LATAM_COUNTRIES.find((country) => country.code === String(code || "").toUpperCase()) ?? LATAM_COUNTRIES[4];

export const onlyPhoneDigits = (value: string) => String(value || "").replace(/\D/g, "");

export const buildInternationalPhone = (countryCode: string, number: string) => {
  const country = getLatamCountry(countryCode);
  const digits = onlyPhoneDigits(number).replace(/^0+/, "");
  if (!digits) return "";
  return digits.startsWith(country.dialCode) ? digits : `${country.dialCode}${digits}`;
};

export const formatInternationalPhone = (countryCode: string, number: string) => {
  const digits = buildInternationalPhone(countryCode, number);
  return digits ? `+${digits}` : "";
};

export const formatStoreCurrency = (value: number, countryCode = "CO") => {
  const country = getLatamCountry(countryCode);
  return new Intl.NumberFormat(country.locale, {
    style: "currency",
    currency: country.currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number(value || 0));
};
