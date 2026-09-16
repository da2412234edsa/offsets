import io.github.spannm.jackcess.ColumnBuilder;
import io.github.spannm.jackcess.DataType;
import io.github.spannm.jackcess.Database;
import io.github.spannm.jackcess.DatabaseBuilder;
import io.github.spannm.jackcess.IndexBuilder;
import io.github.spannm.jackcess.PropertyMap;
import io.github.spannm.jackcess.RelationshipBuilder;
import io.github.spannm.jackcess.Table;
import io.github.spannm.jackcess.TableBuilder;

import java.io.File;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;

/**
 * Builds School_Extracurricular_Clubs_Database.accdb with tables,
 * validation, lookup values, sample data, and referential integrity.
 */
public class CreateDatabase {

    private static Date d(int y, int m, int day) {
        return Date.from(LocalDate.of(y, m, day)
                .atStartOfDay(ZoneId.systemDefault()).toInstant());
    }

    public static void main(String[] args) throws Exception {
        File out = new File(args.length > 0
                ? args[0]
                : "School_Extracurricular_Clubs_Database.accdb");
        if (out.exists() && !out.delete()) {
            throw new IllegalStateException("Could not delete existing file: " + out);
        }

        try (Database db = new DatabaseBuilder(out)
                .withFileFormat(Database.FileFormat.V2010)
                .create()) {

            Table students = new TableBuilder("tbl_Students_Master")
                    .addColumn(new ColumnBuilder("StudentID", DataType.TEXT)
                            .withLengthInUnits(10)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Student ID")
                            .withProperty(PropertyMap.DESCRIPTION_PROP,
                                    "Primary key. Format example: STU101"))
                    .addColumn(new ColumnBuilder("FirstName", DataType.TEXT)
                            .withLengthInUnits(50)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "First Name"))
                    .addColumn(new ColumnBuilder("LastName", DataType.TEXT)
                            .withLengthInUnits(50)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Last Name"))
                    .addColumn(new ColumnBuilder("YearGroup", DataType.INT)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.VALIDATION_RULE_PROP,
                                    ">=7 And <=11")
                            .withProperty(PropertyMap.VALIDATION_TEXT_PROP,
                                    "Year Group must be between 7 and 11.")
                            .withProperty(PropertyMap.CAPTION_PROP, "Year Group"))
                    .addColumn(new ColumnBuilder("EmergencyContact", DataType.TEXT)
                            .withLengthInUnits(20)
                            .withProperty(PropertyMap.CAPTION_PROP, "Emergency Contact"))
                    .addIndex(new IndexBuilder(IndexBuilder.PRIMARY_KEY_NAME)
                            .withColumns("StudentID")
                            .withPrimaryKey())
                    .toTable(db);

            Table clubs = new TableBuilder("tbl_Club_Catalog")
                    .addColumn(new ColumnBuilder("ClubID", DataType.TEXT)
                            .withLengthInUnits(10)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Club ID")
                            .withProperty(PropertyMap.DESCRIPTION_PROP,
                                    "Primary key. Format example: CLB01"))
                    .addColumn(new ColumnBuilder("ClubName", DataType.TEXT)
                            .withLengthInUnits(50)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Club Name"))
                    .addColumn(new ColumnBuilder("Category", DataType.TEXT)
                            .withLengthInUnits(30)
                            .withProperty(PropertyMap.CAPTION_PROP, "Category"))
                    .addColumn(new ColumnBuilder("DayOfWeek", DataType.TEXT)
                            .withLengthInUnits(15)
                            .withProperty(PropertyMap.CAPTION_PROP, "Day Of Week")
                            .withProperty(PropertyMap.DISPLAY_CONTROL_PROP,
                                    PropertyMap.DisplayControl.COMBO_BOX)
                            .withProperty(PropertyMap.ROW_SOURCE_TYPE_PROP, "Value List")
                            .withProperty(PropertyMap.ROW_SOURCE_PROP,
                                    "Monday;Tuesday;Wednesday;Thursday;Friday"))
                    .addColumn(new ColumnBuilder("MaxCapacity", DataType.INT)
                            .withProperty(PropertyMap.CAPTION_PROP, "Max Capacity"))
                    .addIndex(new IndexBuilder(IndexBuilder.PRIMARY_KEY_NAME)
                            .withColumns("ClubID")
                            .withPrimaryKey())
                    .toTable(db);

            Table registrations = new TableBuilder("tbl_Club_Registrations")
                    .addColumn(new ColumnBuilder("RegistrationID", DataType.LONG)
                            .withAutoNumber(true)
                            .withProperty(PropertyMap.CAPTION_PROP, "Registration ID"))
                    .addColumn(new ColumnBuilder("StudentID", DataType.TEXT)
                            .withLengthInUnits(10)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Student ID"))
                    .addColumn(new ColumnBuilder("ClubID", DataType.TEXT)
                            .withLengthInUnits(10)
                            .withProperty(PropertyMap.REQUIRED_PROP, true)
                            .withProperty(PropertyMap.ALLOW_ZERO_LEN_PROP, false)
                            .withProperty(PropertyMap.CAPTION_PROP, "Club ID"))
                    .addColumn(new ColumnBuilder("RegistrationDate", DataType.SHORT_DATE_TIME)
                            .withProperty(PropertyMap.DEFAULT_VALUE_PROP, "=Date()")
                            .withProperty(PropertyMap.FORMAT_PROP, "Short Date")
                            .withProperty(PropertyMap.CAPTION_PROP, "Registration Date"))
                    .addIndex(new IndexBuilder(IndexBuilder.PRIMARY_KEY_NAME)
                            .withColumns("RegistrationID")
                            .withPrimaryKey())
                    .addIndex(new IndexBuilder("idx_StudentID")
                            .withColumns("StudentID"))
                    .addIndex(new IndexBuilder("idx_ClubID")
                            .withColumns("ClubID"))
                    .toTable(db);

            // Relationships with Enforce Referential Integrity
            new RelationshipBuilder(students, registrations)
                    .addColumns("StudentID", "StudentID")
                    .withName("rel_Students_Registrations")
                    .withReferentialIntegrity()
                    .toRelationship(db);

            new RelationshipBuilder(clubs, registrations)
                    .addColumns("ClubID", "ClubID")
                    .withName("rel_Clubs_Registrations")
                    .withReferentialIntegrity()
                    .toRelationship(db);

            // Sample records — tbl_Students_Master
            students.addRow("STU101", "Alex", "Mercer", (short) 8, "99123456");
            students.addRow("STU102", "Elena", "Vassiliou", (short) 9, "99234567");
            students.addRow("STU103", "Daniel", "Smith", (short) 7, "99345678");
            students.addRow("STU104", "Maria", "Constantinou", (short) 11, "99456789");
            students.addRow("STU105", "Liam", "Davies", (short) 10, "99567890");

            // Sample records — tbl_Club_Catalog
            clubs.addRow("CLB01", "Robotics & AI", "STEM", "Tuesday", (short) 15);
            clubs.addRow("CLB02", "Competitive Dance", "Arts", "Thursday", (short) 20);
            clubs.addRow("CLB03", "Basketball Squad", "Sports", "Monday", (short) 12);
            clubs.addRow("CLB04", "Coding & Web Dev", "STEM", "Wednesday", (short) 18);

            // Sample records — tbl_Club_Registrations
            // RegistrationID is AutoNumber; null lets Jackcess assign values 1..n
            registrations.addRow(null, "STU101", "CLB01", d(2026, 9, 10));
            registrations.addRow(null, "STU101", "CLB04", d(2026, 9, 12));
            registrations.addRow(null, "STU102", "CLB02", d(2026, 9, 11));
            registrations.addRow(null, "STU103", "CLB03", d(2026, 9, 14));
            registrations.addRow(null, "STU104", "CLB01", d(2026, 9, 15));
            registrations.addRow(null, "STU105", "CLB02", d(2026, 9, 15));
        }

        System.out.println("Created: " + out.getAbsolutePath());
        System.out.println("Size: " + out.length() + " bytes");
    }
}
