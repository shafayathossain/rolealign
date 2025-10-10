// CV PDF Document Component using @react-pdf/renderer
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { TailoredCV } from './tailoring-engine';

// Register fonts if needed
// Font.register({
//   family: 'Roboto',
//   src: 'https://fonts.gstatic.com/s/roboto/v20/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2'
// });

// Create styles
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 11,
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  header: {
    marginBottom: 20,
    textAlign: 'center',
    borderBottom: '2 solid #2563eb',
    paddingBottom: 10,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e40af',
    marginBottom: 5,
  },
  contactInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    fontSize: 10,
    color: '#6b7280',
  },
  contactItem: {
    marginHorizontal: 5,
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1e40af',
    borderBottom: '1 solid #e5e7eb',
    paddingBottom: 3,
    marginBottom: 8,
  },
  summary: {
    fontStyle: 'italic',
    color: '#4b5563',
    lineHeight: 1.6,
    fontSize: 10,
  },
  experienceItem: {
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemLeft: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  itemCompany: {
    fontSize: 11,
    color: '#2563eb',
    fontWeight: 'bold',
  },
  itemDate: {
    fontSize: 9,
    color: '#6b7280',
    textAlign: 'right',
  },
  itemLocation: {
    fontSize: 9,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  responsibilities: {
    marginTop: 4,
    marginLeft: 15,
  },
  bulletPoint: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  bullet: {
    width: 10,
    fontSize: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: '#374151',
  },
  technologies: {
    marginTop: 4,
    fontSize: 9,
    color: '#6b7280',
  },
  techLabel: {
    fontWeight: 'bold',
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  skillTag: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
    padding: '3 6',
    borderRadius: 2,
    fontSize: 9,
    marginRight: 5,
    marginBottom: 5,
  },
  optimizationBadge: {
    backgroundColor: '#dcfce7',
    color: '#16a34a',
    fontSize: 8,
    padding: '2 4',
    borderRadius: 2,
    marginLeft: 5,
  },
  projectItem: {
    marginBottom: 10,
  },
  projectDescription: {
    fontSize: 10,
    color: '#374151',
    marginTop: 3,
  },
  educationItem: {
    marginBottom: 8,
  },
  certificationItem: {
    marginBottom: 8,
  },
  link: {
    fontSize: 9,
    color: '#2563eb',
    textDecoration: 'none',
  },
});

// Helper component for bullet points
const BulletPoint: React.FC<{ text: string }> = ({ text }) => (
  <View style={styles.bulletPoint}>
    <Text style={styles.bullet}>•</Text>
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

// Main CV Document Component
export const CVDocument: React.FC<{ cv: TailoredCV }> = ({ cv }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.name}>{cv.personalInfo.name}</Text>
        <View style={styles.contactInfo}>
          <Text style={styles.contactItem}>{cv.personalInfo.email}</Text>
          {cv.personalInfo.phone && (
            <Text style={styles.contactItem}>{cv.personalInfo.phone}</Text>
          )}
          {cv.personalInfo.location && (
            <Text style={styles.contactItem}>{cv.personalInfo.location}</Text>
          )}
          {cv.personalInfo.linkedin && (
            <Text style={styles.contactItem}>{cv.personalInfo.linkedin}</Text>
          )}
        </View>
      </View>

      {/* Professional Summary */}
      {cv.summary && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Professional Summary</Text>
          <Text style={styles.summary}>{cv.summary}</Text>
        </View>
      )}

      {/* Professional Experience */}
      {cv.experience && cv.experience.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Professional Experience</Text>
          {cv.experience.map((exp, index) => {
            const isOptimized = cv.optimizations.enhancedExperiences.includes(
              `${exp.position} at ${exp.company}`
            );
            return (
              <View key={index} style={styles.experienceItem}>
                <View style={styles.itemHeader}>
                  <View style={styles.itemLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.itemTitle}>{exp.position}</Text>
                      {isOptimized && (
                        <Text style={styles.optimizationBadge}>Optimized</Text>
                      )}
                    </View>
                    <Text style={styles.itemCompany}>{exp.company}</Text>
                    {exp.location && (
                      <Text style={styles.itemLocation}>{exp.location}</Text>
                    )}
                  </View>
                  <Text style={styles.itemDate}>
                    {exp.startDate} - {exp.endDate}
                  </Text>
                </View>
                {exp.responsibilities && exp.responsibilities.length > 0 && (
                  <View style={styles.responsibilities}>
                    {exp.responsibilities.map((resp, idx) => (
                      <BulletPoint key={idx} text={resp} />
                    ))}
                  </View>
                )}
                {exp.technologies && exp.technologies.length > 0 && (
                  <View style={styles.technologies}>
                    <Text>
                      <Text style={styles.techLabel}>Technologies: </Text>
                      {exp.technologies.join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Key Projects */}
      {cv.projects && cv.projects.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Projects</Text>
          {cv.projects.map((project, index) => {
            const isSelected = cv.optimizations.selectedProjects.includes(project.name);
            return (
              <View key={index} style={styles.projectItem}>
                <View style={styles.itemHeader}>
                  <View style={styles.itemLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.itemTitle}>{project.name}</Text>
                      {isSelected && (
                        <Text style={styles.optimizationBadge}>Selected</Text>
                      )}
                    </View>
                    {project.url && (
                      <Text style={styles.link}>{project.url}</Text>
                    )}
                  </View>
                  {project.startDate && project.endDate && (
                    <Text style={styles.itemDate}>
                      {project.startDate} - {project.endDate}
                    </Text>
                  )}
                </View>
                <Text style={styles.projectDescription}>{project.description}</Text>
                {project.technologies && project.technologies.length > 0 && (
                  <View style={styles.technologies}>
                    <Text>
                      <Text style={styles.techLabel}>Technologies: </Text>
                      {project.technologies.join(', ')}
                    </Text>
                  </View>
                )}
                {project.achievements && project.achievements.length > 0 && (
                  <View style={[styles.responsibilities, { marginTop: 4 }]}>
                    {project.achievements.map((achievement, idx) => (
                      <BulletPoint key={idx} text={achievement} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Technical Skills */}
      {cv.skills && cv.skills.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Technical Skills</Text>
          <View style={styles.skillsContainer}>
            {cv.skills.map((skill, index) => (
              <Text key={index} style={styles.skillTag}>
                {skill}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Education */}
      {cv.education && cv.education.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Education</Text>
          {cv.education.map((edu, index) => (
            <View key={index} style={styles.educationItem}>
              <View style={styles.itemHeader}>
                <View style={styles.itemLeft}>
                  <Text style={styles.itemTitle}>
                    {edu.degree}
                    {edu.field ? ` in ${edu.field}` : ''}
                  </Text>
                  <Text style={styles.itemCompany}>{edu.institution}</Text>
                  {edu.location && (
                    <Text style={styles.itemLocation}>{edu.location}</Text>
                  )}
                  {edu.gpa && (
                    <Text style={styles.itemLocation}>GPA: {edu.gpa}</Text>
                  )}
                </View>
                {edu.startDate && edu.endDate && (
                  <Text style={styles.itemDate}>
                    {edu.startDate} - {edu.endDate}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Certifications */}
      {cv.certifications && cv.certifications.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Certifications</Text>
          {cv.certifications.map((cert, index) => (
            <View key={index} style={styles.certificationItem}>
              <Text style={styles.itemTitle}>{cert.name}</Text>
              <Text style={styles.itemCompany}>{cert.issuer}</Text>
              {cert.date && (
                <Text style={styles.itemLocation}>{cert.date}</Text>
              )}
              {cert.url && (
                <Text style={styles.link}>{cert.url}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </Page>
  </Document>
);

export default CVDocument;