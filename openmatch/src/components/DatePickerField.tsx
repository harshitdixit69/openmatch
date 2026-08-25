import React, { useMemo, useState } from 'react';
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface DatePickerFieldProps {
    value: string; // YYYY-MM-DD
    onChange: (dateStr: string) => void;
    label?: string;
    hasError?: boolean;
    errorMessage?: string;
    minAge?: number;
    maxAge?: number;
}

const MONTHS = [
    { name: 'January', short: 'Jan', num: '01', index: 0 },
    { name: 'February', short: 'Feb', num: '02', index: 1 },
    { name: 'March', short: 'Mar', num: '03', index: 2 },
    { name: 'April', short: 'Apr', num: '04', index: 3 },
    { name: 'May', short: 'May', num: '05', index: 4 },
    { name: 'June', short: 'Jun', num: '06', index: 5 },
    { name: 'July', short: 'Jul', num: '07', index: 6 },
    { name: 'August', short: 'Aug', num: '08', index: 7 },
    { name: 'September', short: 'Sep', num: '09', index: 8 },
    { name: 'October', short: 'Oct', num: '10', index: 9 },
    { name: 'November', short: 'Nov', num: '11', index: 10 },
    { name: 'December', short: 'Dec', num: '12', index: 11 },
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DatePickerField({
    value,
    onChange,
    label,
    hasError = false,
    errorMessage,
    minAge = 18,
    maxAge = 100,
}: DatePickerFieldProps) {
    const [isOpen, setIsOpen] = useState(false);

    // Calculate maximum allowed year (18 years ago) and minimum allowed year (100 years ago)
    const today = new Date();
    const maxYear = today.getFullYear() - minAge;
    const minYear = today.getFullYear() - maxAge;

    // Parsed currently selected date or default (e.g. 26 years ago)
    const parsed = useMemo(() => {
        if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [y, m, d] = value.split('-').map(Number);
            return { year: y, month: m - 1, day: d, valid: true };
        }
        return { year: today.getFullYear() - 25, month: 0, day: 1, valid: false };
    }, [value]);

    const [pickerYear, setPickerYear] = useState<number>(parsed.year);
    const [pickerMonth, setPickerMonth] = useState<number>(parsed.month);
    const [pickerDay, setPickerDay] = useState<number>(parsed.day);
    const [activeTab, setActiveTab] = useState<'calendar' | 'year' | 'month'>('calendar');

    // Calculate days in current picker month
    const daysInMonth = useMemo(() => {
        return new Date(pickerYear, pickerMonth + 1, 0).getDate();
    }, [pickerYear, pickerMonth]);

    // First day of month (0 = Sunday, 1 = Monday, ...)
    const firstDayOfWeek = useMemo(() => {
        return new Date(pickerYear, pickerMonth, 1).getDay();
    }, [pickerYear, pickerMonth]);

    // Computed Age
    const computedAge = useMemo(() => {
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const [y, m, d] = value.split('-').map(Number);
        const birthDate = new Date(y, m - 1, d);
        let age = today.getFullYear() - birthDate.getFullYear();
        const mDiff = today.getMonth() - birthDate.getMonth();
        if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age >= 0 ? age : null;
    }, [value]);

    // Selected display formatted
    const formattedDisplay = useMemo(() => {
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
        const [y, m, d] = value.split('-').map(Number);
        const monthObj = MONTHS[m - 1];
        return `${monthObj ? monthObj.name : m} ${d}, ${y}`;
    }, [value]);

    const toggleOpen = () => {
        if (!isOpen) {
            if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [y, m, d] = value.split('-').map(Number);
                setPickerYear(y);
                setPickerMonth(m - 1);
                setPickerDay(d);
            } else {
                setPickerYear(today.getFullYear() - 25);
                setPickerMonth(0);
                setPickerDay(1);
            }
            setActiveTab('calendar');
        }
        setIsOpen(!isOpen);
    };

    const applyDate = (year: number, month: number, day: number) => {
        const safeDaysCount = new Date(year, month + 1, 0).getDate();
        const safeDay = Math.min(day, safeDaysCount);
        const mStr = String(month + 1).padStart(2, '0');
        const dStr = String(safeDay).padStart(2, '0');
        const dobStr = `${year}-${mStr}-${dStr}`;
        onChange(dobStr);
    };

    const handleSelectDay = (day: number) => {
        setPickerDay(day);
        applyDate(pickerYear, pickerMonth, day);
    };

    const handleSelectMonth = (monthIdx: number) => {
        setPickerMonth(monthIdx);
        setActiveTab('calendar');
        applyDate(pickerYear, monthIdx, pickerDay);
    };

    const handleSelectYear = (yearVal: number) => {
        setPickerYear(yearVal);
        setActiveTab('calendar');
        applyDate(yearVal, pickerMonth, pickerDay);
    };

    // Available Years list
    const yearList = useMemo(() => {
        const years: number[] = [];
        for (let y = maxYear; y >= minYear; y--) {
            years.push(y);
        }
        return years;
    }, [maxYear, minYear]);

    return (
        <View style={styles.wrapper}>
            {label ? <Text style={styles.label}>{label}</Text> : null}

            {/* Main Interactive Trigger */}
            <Pressable
                style={[
                    styles.triggerBox,
                    hasError && styles.triggerBoxError,
                    isOpen && styles.triggerBoxOpen,
                ]}
                onPress={toggleOpen}
                accessibilityRole="button"
                accessibilityLabel="Toggle Date of Birth Calendar"
            >
                <View style={styles.triggerContent}>
                    <Text style={styles.calendarIcon}>📅</Text>
                    {value ? (
                        <View style={styles.dateValuesContainer}>
                            <Text style={styles.selectedDateText}>{formattedDisplay}</Text>
                            <Text style={styles.isoDateText}>{value}</Text>
                        </View>
                    ) : (
                        <Text style={styles.placeholderText}>Click to select Date of Birth</Text>
                    )}
                </View>

                <View style={styles.triggerRight}>
                    {computedAge !== null ? (
                        <View style={[styles.ageBadge, computedAge < minAge && styles.ageBadgeInvalid]}>
                            <Text style={[styles.ageBadgeText, computedAge < minAge && styles.ageBadgeTextInvalid]}>
                                {computedAge} yrs
                            </Text>
                        </View>
                    ) : null}
                    <View style={[styles.actionBtn, isOpen && styles.actionBtnActive]}>
                        <Text style={[styles.actionBtnText, isOpen && styles.actionBtnTextActive]}>
                            {isOpen ? 'Close ▲' : 'Open Calendar ▼'}
                        </Text>
                    </View>
                </View>
            </Pressable>

            {/* Error text if present */}
            {hasError && errorMessage ? (
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            ) : null}

            {/* Expandable Calendar Panel */}
            {isOpen && (
                <View style={styles.calendarCard}>
                    {/* Header Controls */}
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <Text style={styles.cardTitle}>Date of Birth</Text>
                            <Text style={styles.cardSubtitle}>
                                {MONTHS[pickerMonth]?.name} {pickerDay}, {pickerYear}
                            </Text>
                        </View>
                        <Pressable style={styles.doneHeaderBtn} onPress={() => setIsOpen(false)}>
                            <Text style={styles.doneHeaderBtnText}>Done ✓</Text>
                        </Pressable>
                    </View>

                    {/* Navigation Tabs (Month & Year Selector Switchers) */}
                    <View style={styles.tabRow}>
                        <Pressable
                            style={[styles.tabBtn, activeTab === 'calendar' && styles.tabBtnActive]}
                            onPress={() => setActiveTab('calendar')}
                        >
                            <Text style={[styles.tabBtnText, activeTab === 'calendar' && styles.tabBtnTextActive]}>
                                📅 Calendar
                            </Text>
                        </Pressable>

                        <Pressable
                            style={[styles.tabBtn, activeTab === 'month' && styles.tabBtnActive]}
                            onPress={() => setActiveTab(activeTab === 'month' ? 'calendar' : 'month')}
                        >
                            <Text style={[styles.tabBtnText, activeTab === 'month' && styles.tabBtnTextActive]}>
                                {MONTHS[pickerMonth]?.name} ▼
                            </Text>
                        </Pressable>

                        <Pressable
                            style={[styles.tabBtn, activeTab === 'year' && styles.tabBtnActive]}
                            onPress={() => setActiveTab(activeTab === 'year' ? 'calendar' : 'year')}
                        >
                            <Text style={[styles.tabBtnText, activeTab === 'year' && styles.tabBtnTextActive]}>
                                Year: {pickerYear} ▼
                            </Text>
                        </Pressable>
                    </View>

                    {/* Calendar Month View */}
                    {activeTab === 'calendar' && (
                        <View style={styles.calendarBody}>
                            {/* Stepper Navigation */}
                            <View style={styles.stepperRow}>
                                <Pressable
                                    style={styles.arrowBtn}
                                    onPress={() => {
                                        if (pickerMonth === 0) {
                                            if (pickerYear > minYear) {
                                                const newY = pickerYear - 1;
                                                setPickerYear(newY);
                                                setPickerMonth(11);
                                                applyDate(newY, 11, pickerDay);
                                            }
                                        } else {
                                            const newM = pickerMonth - 1;
                                            setPickerMonth(newM);
                                            applyDate(pickerYear, newM, pickerDay);
                                        }
                                    }}
                                >
                                    <Text style={styles.arrowBtnText}>◀ Prev</Text>
                                </Pressable>

                                <Text style={styles.monthYearHeader}>
                                    {MONTHS[pickerMonth]?.name} {pickerYear}
                                </Text>

                                <Pressable
                                    style={styles.arrowBtn}
                                    onPress={() => {
                                        if (pickerMonth === 11) {
                                            if (pickerYear < maxYear) {
                                                const newY = pickerYear + 1;
                                                setPickerYear(newY);
                                                setPickerMonth(0);
                                                applyDate(newY, 0, pickerDay);
                                            }
                                        } else {
                                            const newM = pickerMonth + 1;
                                            setPickerMonth(newM);
                                            applyDate(pickerYear, newM, pickerDay);
                                        }
                                    }}
                                >
                                    <Text style={styles.arrowBtnText}>Next ▶</Text>
                                </Pressable>
                            </View>

                            {/* Days of Week Headers */}
                            <View style={styles.weekDaysRow}>
                                {DAYS_OF_WEEK.map((d) => (
                                    <Text key={d} style={styles.weekDayText}>{d}</Text>
                                ))}
                            </View>

                            {/* Days Grid */}
                            <View style={styles.daysGrid}>
                                {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                                    <View key={`empty-${idx}`} style={styles.emptyDayCell} />
                                ))}

                                {Array.from({ length: daysInMonth }).map((_, idx) => {
                                    const dayNum = idx + 1;
                                    const isSelected = parsed.valid && parsed.year === pickerYear && parsed.month === pickerMonth && parsed.day === dayNum;
                                    return (
                                        <Pressable
                                            key={`day-${dayNum}`}
                                            style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                                            onPress={() => handleSelectDay(dayNum)}
                                        >
                                            <Text style={[styles.dayCellText, isSelected && styles.dayCellTextSelected]}>
                                                {dayNum}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    )}

                    {/* Month Picker View */}
                    {activeTab === 'month' && (
                        <View style={styles.monthsGrid}>
                            {MONTHS.map((m) => {
                                const isSelected = pickerMonth === m.index;
                                return (
                                    <Pressable
                                        key={m.num}
                                        style={[styles.monthCard, isSelected && styles.monthCardSelected]}
                                        onPress={() => handleSelectMonth(m.index)}
                                    >
                                        <Text style={[styles.monthCardText, isSelected && styles.monthCardTextSelected]}>
                                            {m.name}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}

                    {/* Year Picker View */}
                    {activeTab === 'year' && (
                        <ScrollView style={styles.yearScroll} contentContainerStyle={styles.yearGrid}>
                            {yearList.map((y) => {
                                const isSelected = pickerYear === y;
                                return (
                                    <Pressable
                                        key={y}
                                        style={[styles.yearCard, isSelected && styles.yearCardSelected]}
                                        onPress={() => handleSelectYear(y)}
                                    >
                                        <Text style={[styles.yearCardText, isSelected && styles.yearCardTextSelected]}>
                                            {y}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    )}

                    {/* Bottom Quick Presets and Confirm Button */}
                    <View style={styles.cardFooter}>
                        <Pressable style={styles.confirmButton} onPress={() => setIsOpen(false)}>
                            <Text style={styles.confirmButtonText}>Confirm & Apply</Text>
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        gap: 6,
        width: '100%',
    },
    label: {
        color: '#34505c',
        fontSize: 13,
        fontWeight: '700',
    },
    triggerBox: {
        alignItems: 'center',
        backgroundColor: '#f7fafb',
        borderColor: '#e2e7f5',
        borderRadius: 12,
        borderWidth: 1.5,
        cursor: 'pointer' as any,
        flexDirection: 'row',
        justifyContent: 'space-between',
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    triggerBoxOpen: {
        borderColor: '#ff6a3d',
        backgroundColor: '#ffffff',
    },
    triggerBoxError: {
        borderColor: '#e53935',
        backgroundColor: '#fff8f8',
    },
    triggerContent: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        flex: 1,
    },
    calendarIcon: {
        fontSize: 22,
    },
    dateValuesContainer: {
        flexDirection: 'column',
    },
    selectedDateText: {
        color: '#10232a',
        fontSize: 15,
        fontWeight: '700',
    },
    isoDateText: {
        color: '#5a6488',
        fontSize: 12,
        fontWeight: '500',
    },
    placeholderText: {
        color: '#5a6488',
        fontSize: 15,
        fontWeight: '500',
    },
    triggerRight: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    ageBadge: {
        backgroundColor: '#e6f7f2',
        borderColor: '#2bb673',
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    ageBadgeInvalid: {
        backgroundColor: '#fde8e8',
        borderColor: '#e53935',
    },
    ageBadgeText: {
        color: '#1a7a5e',
        fontSize: 12,
        fontWeight: '700',
    },
    ageBadgeTextInvalid: {
        color: '#e53935',
    },
    actionBtn: {
        backgroundColor: '#eef5f7',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    actionBtnActive: {
        backgroundColor: '#13333f',
    },
    actionBtnText: {
        color: '#13333f',
        fontSize: 12,
        fontWeight: '700',
    },
    actionBtnTextActive: {
        color: '#ffffff',
    },
    errorText: {
        color: '#e53935',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
    calendarCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e7f5',
        borderRadius: 16,
        borderWidth: 1.5,
        marginTop: 6,
        overflow: 'hidden',
        shadowColor: '#13333f',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    cardHeader: {
        alignItems: 'center',
        backgroundColor: '#13333f',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    cardHeaderLeft: {
        gap: 2,
    },
    cardTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    cardSubtitle: {
        color: '#f3b499',
        fontSize: 13,
        fontWeight: '600',
    },
    doneHeaderBtn: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    doneHeaderBtnText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
    },
    tabRow: {
        backgroundColor: '#f1f5f7',
        borderBottomColor: '#e2e7f5',
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 6,
        padding: 8,
    },
    tabBtn: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e7f5',
        borderRadius: 8,
        borderWidth: 1,
        flex: 1,
        paddingVertical: 6,
        alignItems: 'center',
    },
    tabBtnActive: {
        backgroundColor: '#13333f',
        borderColor: '#13333f',
    },
    tabBtnText: {
        color: '#13333f',
        fontSize: 12,
        fontWeight: '700',
    },
    tabBtnTextActive: {
        color: '#ffffff',
    },
    calendarBody: {
        padding: 12,
    },
    stepperRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    arrowBtn: {
        backgroundColor: '#f1f5f7',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    arrowBtnText: {
        color: '#13333f',
        fontSize: 12,
        fontWeight: '700',
    },
    monthYearHeader: {
        color: '#13333f',
        fontSize: 14,
        fontWeight: '800',
    },
    weekDaysRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 4,
    },
    weekDayText: {
        color: '#5a6488',
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
        width: 34,
    },
    daysGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 4,
    },
    emptyDayCell: {
        height: 36,
        width: `${100 / 7}%`,
    },
    dayCell: {
        alignItems: 'center',
        borderRadius: 8,
        height: 36,
        justifyContent: 'center',
        width: `${100 / 7}%`,
    },
    dayCellSelected: {
        backgroundColor: '#ff6a3d',
    },
    dayCellText: {
        color: '#10232a',
        fontSize: 13,
        fontWeight: '600',
    },
    dayCellTextSelected: {
        color: '#ffffff',
        fontWeight: '800',
    },
    monthsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        padding: 12,
    },
    monthCard: {
        alignItems: 'center',
        backgroundColor: '#f1f5f7',
        borderColor: '#e2e7f5',
        borderRadius: 8,
        borderWidth: 1,
        paddingVertical: 10,
        width: '31%',
    },
    monthCardSelected: {
        backgroundColor: '#ff6a3d',
        borderColor: '#ff6a3d',
    },
    monthCardText: {
        color: '#13333f',
        fontSize: 12,
        fontWeight: '700',
    },
    monthCardTextSelected: {
        color: '#ffffff',
    },
    yearScroll: {
        maxHeight: 220,
        padding: 10,
    },
    yearGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'space-between',
    },
    yearCard: {
        alignItems: 'center',
        backgroundColor: '#f1f5f7',
        borderColor: '#e2e7f5',
        borderRadius: 8,
        borderWidth: 1,
        paddingVertical: 8,
        width: '31%',
    },
    yearCardSelected: {
        backgroundColor: '#ff6a3d',
        borderColor: '#ff6a3d',
    },
    yearCardText: {
        color: '#13333f',
        fontSize: 13,
        fontWeight: '700',
    },
    yearCardTextSelected: {
        color: '#ffffff',
    },
    cardFooter: {
        borderTopColor: '#e2e7f5',
        borderTopWidth: 1,
        padding: 10,
    },
    confirmButton: {
        alignItems: 'center',
        backgroundColor: '#ff6a3d',
        borderRadius: 10,
        paddingVertical: 10,
    },
    confirmButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
});
