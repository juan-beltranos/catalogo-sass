export type LatamCountry = {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  example: string;
};

export const LATAM_COUNTRIES: LatamCountry[] = [
  { code: "AR", name: "Argentina", flag: "🇦🇷", dialCode: "54", example: "91123456789" },
  { code: "BO", name: "Bolivia", flag: "🇧🇴", dialCode: "591", example: "71234567" },
  { code: "BR", name: "Brasil", flag: "🇧🇷", dialCode: "55", example: "11912345678" },
  { code: "CL", name: "Chile", flag: "🇨🇱", dialCode: "56", example: "912345678" },
  { code: "CO", name: "Colombia", flag: "🇨🇴", dialCode: "57", example: "3001112233" },
  { code: "CR", name: "Costa Rica", flag: "🇨🇷", dialCode: "506", example: "83123456" },
  { code: "CU", name: "Cuba", flag: "🇨🇺", dialCode: "53", example: "51234567" },
  { code: "DO", name: "República Dominicana", flag: "🇩🇴", dialCode: "1", example: "8092345678" },
  { code: "EC", name: "Ecuador", flag: "🇪🇨", dialCode: "593", example: "991234567" },
  { code: "SV", name: "El Salvador", flag: "🇸🇻", dialCode: "503", example: "70123456" },
  { code: "GT", name: "Guatemala", flag: "🇬🇹", dialCode: "502", example: "51234567" },
  { code: "HT", name: "Haití", flag: "🇭🇹", dialCode: "509", example: "34123456" },
  { code: "HN", name: "Honduras", flag: "🇭🇳", dialCode: "504", example: "91234567" },
  { code: "MX", name: "México", flag: "🇲🇽", dialCode: "52", example: "5512345678" },
  { code: "NI", name: "Nicaragua", flag: "🇳🇮", dialCode: "505", example: "81234567" },
  { code: "PA", name: "Panamá", flag: "🇵🇦", dialCode: "507", example: "61234567" },
  { code: "PY", name: "Paraguay", flag: "🇵🇾", dialCode: "595", example: "981123456" },
  { code: "PE", name: "Perú", flag: "🇵🇪", dialCode: "51", example: "912345678" },
  { code: "PR", name: "Puerto Rico", flag: "🇵🇷", dialCode: "1", example: "7872345678" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾", dialCode: "598", example: "91234567" },
  { code: "VE", name: "Venezuela", flag: "🇻🇪", dialCode: "58", example: "4121234567" },
];

export const getLatamCountry = (code: string) =>
  LATAM_COUNTRIES.find((country) => country.code === code) ?? LATAM_COUNTRIES[4];

export const onlyPhoneDigits = (value: string) => value.replace(/\D/g, "");

export const buildInternationalPhone = (countryCode: string, nationalNumber: string) => {
  const country = getLatamCountry(countryCode);
  const localDigits = onlyPhoneDigits(nationalNumber).replace(/^0+/, "");
  return `${country.dialCode}${localDigits}`;
};
