# School Extracurricular Clubs Database

Microsoft Access database for the Practical Task assignment.

## Download / open this file

**Main file:** `School_Extracurricular_Clubs_Database.accdb`

Open it in Microsoft Access (Windows). Close Access before uploading to Google Classroom.

## What is already built

### 1. Tables + sample records + validation
| Table | Notes |
|-------|--------|
| `tbl_Students_Master` | PK `StudentID`; Required First/Last name; YearGroup validation `>=7 And <=11` |
| `tbl_Club_Catalog` | PK `ClubID`; Required ClubName; DayOfWeek combo (Mon–Fri value list) |
| `tbl_Club_Registrations` | PK AutoNumber `RegistrationID`; Default `=Date()` on RegistrationDate |

All sample records from the brief are loaded (5 students, 4 clubs, 6 registrations).

### 2. Relationships (Enforce Referential Integrity)
- `tbl_Students_Master.StudentID` → `tbl_Club_Registrations.StudentID` (1–Many)
- `tbl_Club_Catalog.ClubID` → `tbl_Club_Registrations.ClubID` (1–Many)

### 3. Forms (create in Access — takes ~2 minutes)

Access form design objects require Microsoft Access. Use either method below.

#### Method A — Form Wizard (matches the assignment steps)

**frm_Student_Entry**
1. Select `tbl_Students_Master` → Create → Form Wizard  
2. Add all fields → Columnar → title `frm_Student_Entry` → Finish  

**frm_Club_Registrations_Master**
1. Create → Form Wizard  
2. From `tbl_Students_Master` add: StudentID, FirstName, LastName, YearGroup  
3. From `tbl_Club_Registrations` add: RegistrationID, ClubID, RegistrationDate  
4. View by `tbl_Students_Master` → Form with subform(s)  
5. Subform layout: Datasheet or Tabular  
6. Names: Main `frm_Club_Registrations_Master`, Subform `tbl_Club_Registrations_Subform` → Finish  

#### Method B — one-click VBA
1. In Access: Create → Module  
2. Paste the code from `CreateForms_Module.bas` (skip the `Attribute VB_Name` line if pasting)  
3. Press F5 on `CreateAllForms` (or Immediate Window: `Call CreateAllForms`)

## Submit checklist
1. Save all objects and close Access  
2. Upload `School_Extracurricular_Clubs_Database.accdb` to Google Classroom  
