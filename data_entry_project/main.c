#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

typedef struct {
    char name[64];
    int roll;
    float marks;
} Student;

static void trim_newline(char *s) {
    if (!s) return;
    size_t n = strlen(s);
    if (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r')) s[n - 1] = '\0';
    n = strlen(s);
    if (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r')) s[n - 1] = '\0';
}

static int read_line(char *buf, size_t cap) {
    if (!fgets(buf, (int)cap, stdin)) return 0;
    trim_newline(buf);
    return 1;
}

static int parse_int_strict(const char *s, int *out) {
    if (!s) return 0;
    while (isspace((unsigned char)*s)) s++;
    if (*s == '\0') return 0;
    char *end = NULL;
    long v = strtol(s, &end, 10);
    while (end && isspace((unsigned char)*end)) end++;
    if (!end || *end != '\0') return 0;
    if (v < -2147483648L || v > 2147483647L) return 0;
    *out = (int)v;
    return 1;
}

static int parse_float_strict(const char *s, float *out) {
    if (!s) return 0;
    while (isspace((unsigned char)*s)) s++;
    if (*s == '\0') return 0;
    char *end = NULL;
    float v = strtof(s, &end);
    while (end && isspace((unsigned char)*end)) end++;
    if (!end || *end != '\0') return 0;
    *out = v;
    return 1;
}

static int prompt_int(const char *label, int *out) {
    char line[128];
    for (;;) {
        printf("%s", label);
        if (!read_line(line, sizeof line)) return 0;
        if (parse_int_strict(line, out)) return 1;
        printf("Invalid number. Please try again.\n");
    }
}

static int prompt_float(const char *label, float *out) {
    char line[128];
    for (;;) {
        printf("%s", label);
        if (!read_line(line, sizeof line)) return 0;
        if (parse_float_strict(line, out)) return 1;
        printf("Invalid number. Please try again.\n");
    }
}

static int prompt_string(const char *label, char *out, size_t cap) {
    char line[256];
    for (;;) {
        printf("%s", label);
        if (!read_line(line, sizeof line)) return 0;
        if (line[0] == '\0') {
            printf("Input cannot be empty. Please try again.\n");
            continue;
        }
        strncpy(out, line, cap - 1);
        out[cap - 1] = '\0';
        return 1;
    }
}

static void print_report(const Student *students, int n) {
    float total = 0.0f;
    float minm = 0.0f, maxm = 0.0f;
    int minIdx = -1, maxIdx = -1;

    for (int i = 0; i < n; i++) {
        float m = students[i].marks;
        total += m;
        if (i == 0 || m < minm) {
            minm = m;
            minIdx = i;
        }
        if (i == 0 || m > maxm) {
            maxm = m;
            maxIdx = i;
        }
    }

    printf("\n=== Student List ===\n");
    printf("%-5s  %-25s  %-10s\n", "Roll", "Name", "Marks");
    printf("-----  -------------------------  ----------\n");
    for (int i = 0; i < n; i++) {
        printf("%-5d  %-25s  %-10.2f\n", students[i].roll, students[i].name, students[i].marks);
    }

    printf("\n=== Summary ===\n");
    printf("Count: %d\n", n);
    printf("Average marks: %.2f\n", (n > 0) ? (total / (float)n) : 0.0f);
    if (n > 0) {
        printf("Highest: %.2f (%s, Roll %d)\n", students[maxIdx].marks, students[maxIdx].name, students[maxIdx].roll);
        printf("Lowest : %.2f (%s, Roll %d)\n", students[minIdx].marks, students[minIdx].name, students[minIdx].roll);
    }
}

int main(void) {
    printf("Student Data Entry Program\n");
    printf("--------------------------\n");

    int n = 0;
    if (!prompt_int("Enter number of students: ", &n)) {
        fprintf(stderr, "Input error.\n");
        return 1;
    }
    while (n <= 0) {
        printf("Number of students must be > 0.\n");
        if (!prompt_int("Enter number of students: ", &n)) {
            fprintf(stderr, "Input error.\n");
            return 1;
        }
    }

    Student *students = (Student *)calloc((size_t)n, sizeof(Student));
    if (!students) {
        fprintf(stderr, "Out of memory.\n");
        return 1;
    }

    for (int i = 0; i < n; i++) {
        printf("\n-- Student %d --\n", i + 1);
        if (!prompt_string("Name : ", students[i].name, sizeof students[i].name)) {
            fprintf(stderr, "Input error.\n");
            free(students);
            return 1;
        }
        if (!prompt_int("Roll : ", &students[i].roll)) {
            fprintf(stderr, "Input error.\n");
            free(students);
            return 1;
        }
        if (!prompt_float("Marks: ", &students[i].marks)) {
            fprintf(stderr, "Input error.\n");
            free(students);
            return 1;
        }
    }

    print_report(students, n);

    free(students);
    return 0;
}

