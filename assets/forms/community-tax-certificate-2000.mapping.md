# Community Tax Certificate Field Mapping

This template maps the interview answers onto the taxpayer copy of the Community Tax Certificate form shown in the provided reference image.

## Source Files

- Background layout: `assets/forms/community-tax-certificate-2000.svg`
- Coordinate template: `assets/forms/community-tax-certificate-2000.template.json`

## Interview Key to Form Placement

- `surname`
  Placed on the `NAME (SURNAME)` line in the left half of the name row.
- `firstName`
  Placed on the `(FIRST)` segment in the center of the name row.
- `middleName`
  Placed on the `(MIDDLE)` segment at the right side of the name row.
- `address`
  Placed across the full `ADDRESS` line.
- `citizenship`
  Placed in the `CITIZENSHIP` cell.
- `sex`
  Rendered as an `X` centered inside the `MALE` or `FEMALE` checkbox.
- `placeOfBirth`
  Placed in the `PLACE OF BIRTH` cell.
- `dateOfBirth`
  Placed in the `DATE OF BIRTH` cell.
- `height`
  Placed in the `HEIGHT` cell.
- `weight`
  Placed in the `WEIGHT` cell.
- `civilStatus`
  Rendered as an `X` in the matching civil-status checkbox.
- `profession`
  Placed on the `PROFESSION / OCCUPATION / BUSINESS` line.
- `tinNumber`
  Split into digits and placed across the nine TIN boxes.

## Notes

- `middleName = None` is left blank on the form.
- `tinNumber` is left blank when `hasTin = No`.
- The PDF export now produces only the mapped certificate page; the interview-summary page is not included.
- The traced SVG is designed to keep the coordinate system stable for PDF export. If you later replace it with a higher-resolution scan of the same form, only the coordinates may need minor adjustment.
